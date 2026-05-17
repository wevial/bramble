import type { Agent, AgentName, StreamTail, Token, TurnContext, TurnUsage } from './agent.js';
import { streamProcessLines, type SpawnSpec } from './subprocess.js';
import { parseCodexEvent } from './codex-events.js';
import { systemInstructions } from '../prompts/system.js';
import {
  createCodexTransport,
  type CodexTransport,
} from './codex-transport.js';

export type CodexAgentOptions = {
  /** Override the line-stream source for testing. Default spawns `codex`. */
  streamLines?: (prompt: string, signal: AbortSignal) => AsyncIterable<string>;
  /** Inject a transport directly (for tests of the persistent path). */
  transport?: CodexTransport;
  systemInstructions?: string;
  /** Pinned model id. Default uses the CLI default from ~/.codex/config.toml. */
  model?: string;
  /** Reasoning effort override, e.g. "low" | "medium" | "high". */
  reasoningEffort?: string;
  /**
   * Working directory for the spawned `codex` subprocess. When set, AGENTS.md
   * and other repo-local context in the parent project won't leak into the
   * debate. Used by the --isolated flag.
   */
  cwd?: string;
  /**
   * Sandbox mode passed via `-s`. Use 'read-only' to let codex grep/read
   * the repo while drafting the spec without granting writes.
   */
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
};

export function codexSpawnSpec(
  prompt: string,
  opts: {
    model?: string;
    reasoningEffort?: string;
    cwd?: string;
    sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  } = {},
): SpawnSpec {
  const args = ['exec', '--json'];
  if (opts.model) args.push('-m', opts.model);
  if (opts.reasoningEffort) {
    args.push('-c', `model_reasoning_effort=${opts.reasoningEffort}`);
  }
  if (opts.sandbox) args.push('-s', opts.sandbox);
  args.push(prompt);
  const spec: SpawnSpec = { cmd: 'codex', args };
  if (opts.cwd) spec.cwd = opts.cwd;
  return spec;
}

import { CLAUDE_PERSONA, CODEX_PERSONA } from '../personas/personas.js';

const DEFAULT_PROTOCOL = systemInstructions(CODEX_PERSONA, [CLAUDE_PERSONA]);

function defaultSpawn(
  prompt: string,
  signal: AbortSignal,
  model: string | undefined,
  reasoningEffort: string | undefined,
  cwd: string | undefined,
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access' | undefined,
): AsyncIterable<string> {
  return streamProcessLines(
    codexSpawnSpec(prompt, { model, reasoningEffort, cwd, sandbox }),
    signal,
  );
}

/**
 * Wrap a legacy per-turn `streamLines` callback as a CodexTransport. Every
 * turn spawns a fresh line source — identical to the old behavior. Only used
 * by existing tests that predate the persistent transport.
 */
function perTurnTransport(
  streamLines: (prompt: string, signal: AbortSignal) => AsyncIterable<string>,
): CodexTransport {
  let gen = 0;
  return {
    runTurn(prompt, signal) {
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

export class CodexAgent implements Agent {
  readonly name: AgentName = 'codex';
  private readonly transport: CodexTransport;
  private readonly supportsDeltaPrompts: boolean;
  private readonly systemInstructions: string;
  private hasSessionContext = false;
  private seededGeneration = -1;

  constructor(opts: CodexAgentOptions = {}) {
    this.systemInstructions = opts.systemInstructions ?? DEFAULT_PROTOCOL;

    if (opts.transport) {
      // Injected transport (tests or external config).
      this.transport = opts.transport;
      this.supportsDeltaPrompts = true;
    } else if (opts.streamLines) {
      // Legacy per-turn line source — no delta prompt support.
      this.transport = perTurnTransport(opts.streamLines);
      this.supportsDeltaPrompts = false;
    } else if (process.env.OPENAI_API_KEY) {
      // Persistent API transport — delta prompts enabled.
      this.transport = createCodexTransport({
        model: opts.model,
        reasoningEffort: opts.reasoningEffort,
        systemInstructions: this.systemInstructions,
      });
      this.supportsDeltaPrompts = true;
    } else {
      // Default: spawn `codex exec` per turn via CLI.
      this.transport = perTurnTransport((p, s) =>
        defaultSpawn(p, s, opts.model, opts.reasoningEffort, opts.cwd, opts.sandbox),
      );
      this.supportsDeltaPrompts = false;
    }
  }

  async *stream(
    ctx: TurnContext,
    signal: AbortSignal,
  ): AsyncGenerator<Token, StreamTail | void, void> {
    const generation = this.transport.sessionGeneration();
    const sessionStillAlive =
      this.hasSessionContext && generation === this.seededGeneration;
    const useDelta =
      this.supportsDeltaPrompts && sessionStillAlive && !!ctx.deltaPrompt;

    // For CLI-based transports, prepend system instructions to the prompt.
    // API-based transports receive them via the `instructions` field.
    const rawPrompt = useDelta ? ctx.deltaPrompt! : ctx.prompt;
    const prompt = this.supportsDeltaPrompts
      ? rawPrompt
      : `${this.systemInstructions}\n\n---\n\n${rawPrompt}`;
    const promptMode = useDelta ? 'delta' : 'full';

    let fullText = '';
    let usage: TurnUsage | undefined;
    let subprocessError: string | null = null;

    try {
      for await (const line of this.transport.runTurn(prompt, signal)) {
        if (signal.aborted) break;
        const evt = parseCodexEvent(line);
        if (evt === null) continue;
        if (evt.kind === 'message') {
          fullText += evt.text;
          yield { text: evt.text };
        } else {
          usage = evt.usage;
        }
      }
    } catch (err) {
      subprocessError = (err as Error)?.message ?? String(err);
    }

    this.hasSessionContext = !signal.aborted && subprocessError === null;
    this.seededGeneration = this.transport.lastTurnGeneration();

    if (this.supportsDeltaPrompts && usage) {
      usage = {
        ...usage,
        promptMode,
        promptChars: prompt.length,
        fullPromptChars: ctx.prompt.length,
        deltaPromptChars: ctx.deltaPrompt?.length,
      };
    }

    if (subprocessError && fullText.length === 0) {
      const errMsg = `⚠ codex subprocess failed: ${subprocessError}`;
      yield { text: errMsg };
      return {
        raw: JSON.stringify({ commentary: errMsg }),
        usage,
      };
    }
    return { raw: fullText, usage };
  }

  dispose() {
    this.hasSessionContext = false;
    this.transport.dispose();
  }
}
