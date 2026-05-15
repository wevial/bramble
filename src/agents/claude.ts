import type { Agent, AgentName, StreamTail, Token, TurnContext, TurnUsage } from './agent.js';
import { parseClaudeEvent } from './claude-events.js';
import {
  createClaudeTransport,
  type ClaudeTransport,
  claudeTransportArgs,
} from './claude-transport.js';

export type ClaudeAgentOptions = {
  /**
   * Legacy per-turn override for testing: if given, each turn spawns a fresh
   * line stream. Production uses a long-lived `ClaudeTransport` instead — see
   * claude-transport.ts. Prefer `transport` for new tests.
   */
  streamLines?: (prompt: string, signal: AbortSignal) => AsyncIterable<string>;
  /** Inject a transport directly (for tests of the long-lived path). */
  transport?: ClaudeTransport;
  /**
   * Appended to the CLI's system prompt as the bramble debate protocol.
   * Stable across turns, so it sits inside the cacheable system prefix.
   */
  systemInstructions?: string;
  /** Pinned model id (e.g. "claude-sonnet-4-6"). Default uses the CLI default. */
  model?: string;
  /** Reasoning effort: "low" | "medium" | "high" | "xhigh" | "max". */
  reasoningEffort?: string;
  /**
   * Working directory for the spawned `claude` subprocess. When set, CLAUDE.md
   * and other repo-local context in the parent project won't leak into the
   * debate. Used by the --isolated flag.
   */
  cwd?: string;
  /** Read-only tool allow-list. See ClaudeTransportOptions.allowedTools. */
  allowedTools?: string[];
};

/** Exposed for tests — returns the argv shape the long-lived transport uses. */
export function claudeTransportArgsFor(opts: {
  model?: string;
  reasoningEffort?: string;
  cwd?: string;
  appendSystemPrompt?: string;
}): string[] {
  return claudeTransportArgs(opts);
}

import { systemInstructions } from '../prompts/system.js';
import { CLAUDE_PERSONA, CODEX_PERSONA } from '../personas/personas.js';

const DEFAULT_PROTOCOL = systemInstructions(CLAUDE_PERSONA, [CODEX_PERSONA]);

/**
 * Wrap a legacy per-turn `streamLines` callback as a ClaudeTransport. Every
 * turn spawns a fresh line source — identical to the old behavior. Only used
 * by existing tests that predate the long-lived transport.
 */
function perTurnTransport(
  streamLines: (prompt: string, signal: AbortSignal) => AsyncIterable<string>,
): ClaudeTransport {
  let gen = 0;
  return {
    runTurn(prompt, signal) {
      // Each turn is its own ephemeral "session" in the legacy path.
      gen++;
      return streamLines(prompt, signal);
    },
    sessionGeneration() {
      return gen;
    },
    lastTurnGeneration() {
      return gen;
    },
    dispose() {
      /* nothing to tear down per turn */
    },
  };
}

export class ClaudeAgent implements Agent {
  readonly name: AgentName = 'claude';
  private readonly transport: ClaudeTransport;
  private readonly supportsDeltaPrompts: boolean;
  private hasSessionContext = false;
  /**
   * The transport generation under which `hasSessionContext` was last set.
   * If the transport silently respawned its child (generation moved), the
   * stored conversation history was lost and we must send a full prompt.
   */
  private seededGeneration = -1;

  constructor(opts: ClaudeAgentOptions = {}) {
    const systemInstructions = opts.systemInstructions ?? DEFAULT_PROTOCOL;
    this.supportsDeltaPrompts = opts.streamLines === undefined;
    if (opts.transport) {
      this.transport = opts.transport;
    } else if (opts.streamLines) {
      this.transport = perTurnTransport(opts.streamLines);
    } else {
      this.transport = createClaudeTransport({
        model: opts.model,
        reasoningEffort: opts.reasoningEffort,
        cwd: opts.cwd,
        appendSystemPrompt: systemInstructions,
        allowedTools: opts.allowedTools,
      });
    }
  }

  async *stream(
    ctx: TurnContext,
    signal: AbortSignal,
  ): AsyncGenerator<Token, StreamTail | void, void> {
    // The debate protocol rides in --append-system-prompt (stable across the
    // session). Once the persistent Claude session has been seeded with one
    // full prompt, send only the new debate delta so we don't duplicate the
    // whole transcript inside every subsequent user message.
    //
    // If the transport's child died between turns, generation will have moved
    // past seededGeneration — the stored conversation is gone, so we can't
    // rely on Claude having prior context. Fall back to a full prompt.
    const generation = this.transport.sessionGeneration();
    const sessionStillAlive =
      this.hasSessionContext && generation === this.seededGeneration;
    const useDelta =
      this.supportsDeltaPrompts && sessionStillAlive && !!ctx.deltaPrompt;
    const prompt = useDelta ? ctx.deltaPrompt! : ctx.prompt;
    const promptMode = useDelta ? 'delta' : 'full';
    let accumulated = '';
    let finalResult: string | null = null;
    let usage: TurnUsage | undefined;
    let subprocessError: string | null = null;

    try {
      for await (const line of this.transport.runTurn(prompt, signal)) {
        if (signal.aborted) break;
        const evt = parseClaudeEvent(line);
        if (evt === null) continue;
        if (evt.kind === 'text') {
          accumulated += evt.text;
          yield { text: evt.text };
        } else {
          finalResult = evt.result;
          usage = evt.usage;
        }
      }
    } catch (err) {
      subprocessError = (err as Error)?.message ?? String(err);
    }
    this.hasSessionContext = !signal.aborted && subprocessError === null;
    // Record the generation the turn actually ran under — snapshotted by the
    // transport at turn start, so a `close` bump that fires after the result
    // but before we read here doesn't poison seededGeneration.
    this.seededGeneration = this.transport.lastTurnGeneration();
    if (usage) {
      usage = {
        ...usage,
        promptMode,
        promptChars: prompt.length,
        fullPromptChars: ctx.prompt.length,
        deltaPromptChars: ctx.deltaPrompt?.length,
      };
    }

    if (subprocessError && !finalResult && accumulated.length === 0) {
      const errMsg = `⚠ claude subprocess failed: ${subprocessError}`;
      yield { text: errMsg };
      return {
        raw: JSON.stringify({ commentary: errMsg }),
        usage,
      };
    }

    return { raw: finalResult ?? accumulated, usage };
  }

  dispose() {
    this.hasSessionContext = false;
    this.transport.dispose();
  }
}
