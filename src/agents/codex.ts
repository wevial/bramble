import type { Agent, AgentName, StreamTail, Token, TurnContext, TurnUsage } from './agent.js';
import { createAppServerTransport } from './codex-appserver.js';
import { streamProcessLines, type SpawnSpec } from './subprocess.js';
import { parseCodexEvent } from './codex-events.js';
import { systemInstructions } from '../prompts/system.js';

export interface CodexTransport {
  runTurn(promptText: string, signal: AbortSignal): AsyncIterable<string>;
  sessionGeneration(): number;
  lastTurnGeneration(): number;
  dispose(): void;
}

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
  /**
   * Which CLI transport to use. 'app-server' (default) keeps one persistent
   * `codex app-server` process per debate — no per-turn CLI cold start and
   * real streaming deltas. 'exec' spawns `codex exec … resume <id>` per turn
   * (the legacy path, kept as an escape hatch via --codex-transport exec).
   */
  transportKind?: 'exec' | 'app-server';
  /**
   * Kill the subprocess and fail the turn if it produces no output for this
   * long during an in-flight turn. <= 0 disables. Default 5 minutes.
   */
  idleTimeoutMs?: number;
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

/**
 * Persistent CLI transport that captures the `thread_id` from `codex exec`
 * output and `resume <id>`s on subsequent turns, giving Codex conversation
 * continuity while staying on the user's CLI subscription.
 *
 * Exported for tests; `spawn` is injectable so the arg construction (notably
 * the `resume` subcommand syntax) can be asserted without a live `codex` CLI.
 */
export function createPersistentCliTransport(opts: {
  model?: string;
  reasoningEffort?: string;
  cwd?: string;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  idleTimeoutMs?: number;
  spawn?: (spec: SpawnSpec, signal: AbortSignal) => AsyncIterable<string>;
}): CodexTransport {
  const spawn =
    opts.spawn ??
    ((spec: SpawnSpec, signal: AbortSignal) =>
      streamProcessLines(spec, signal, {
        idleTimeoutMs: opts.idleTimeoutMs,
        what: '`codex exec` turn',
      }));
  let sessionId: string | null = null;
  let generation = 0;
  let turnGen = 0;

  return {
    runTurn(prompt, signal) {
      const args = ['exec', '--json'];
      if (opts.model) args.push('-m', opts.model);
      if (opts.reasoningEffort) {
        args.push('-c', `model_reasoning_effort=${opts.reasoningEffort}`);
      }
      if (opts.sandbox) args.push('-s', opts.sandbox);
      // `resume` is an `exec` subcommand (`codex exec [OPTIONS] resume
      // <SESSION_ID> [PROMPT]`), not a `--resume` flag — the flag form is
      // rejected with "unexpected argument '--resume'". It must follow the
      // options and precede the prompt.
      if (sessionId) args.push('resume', sessionId);
      args.push(prompt);
      const spec: SpawnSpec = { cmd: 'codex', args };
      if (opts.cwd) spec.cwd = opts.cwd;

      turnGen = generation;

      return (async function* () {
        let threw = false;
        try {
          for await (const line of spawn(spec, signal)) {
            // Capture thread_id so subsequent turns can `resume`.
            if (sessionId === null) {
              try {
                const obj = JSON.parse(line.trim());
                if (
                  typeof obj === 'object' &&
                  obj !== null &&
                  obj.type === 'thread.started' &&
                  typeof obj.thread_id === 'string'
                ) {
                  sessionId = obj.thread_id;
                }
              } catch {
                /* not JSON — ignore */
              }
            }
            yield line;
          }
          if (sessionId === null) {
            // No thread_id captured — the CLI doesn't support resume (or the
            // event was missing). Bump generation so the agent falls back to
            // full prompts instead of sending deltas to a contextless subprocess.
            console.warn(
              '[bramble] codex exec did not emit thread.started — ' +
              'persistent session disabled for this turn',
            );
            generation++;
          }
        } catch (err) {
          // Subprocess crashed — session is lost.
          threw = true;
          sessionId = null;
          generation++;
          throw err;
        } finally {
          // Runs on normal completion, early .return() from consumer break,
          // AND after the catch re-throws. Skip if catch already cleaned up.
          if (!threw && signal.aborted) {
            // Abort killed the subprocess mid-turn — discard the session so
            // the next turn starts fresh (avoids system-instructions duplication
            // from sending a full prompt via --resume to a session that already
            // has them).
            sessionId = null;
            generation++;
          }
        }
      })();
    },
    sessionGeneration() {
      return generation;
    },
    lastTurnGeneration() {
      return turnGen;
    },
    dispose() {
      sessionId = null;
    },
  };
}

/**
 * Wrap a per-turn `streamLines` callback as a CodexTransport. Every turn
 * spawns a fresh line source with no conversation continuity. Used by tests
 * that inject a custom line source via `opts.streamLines`.
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
    } else if (opts.transportKind === 'exec') {
      // Legacy: per-turn `codex exec` with thread_id capture + `resume`.
      this.transport = createPersistentCliTransport({
        model: opts.model,
        reasoningEffort: opts.reasoningEffort,
        cwd: opts.cwd,
        sandbox: opts.sandbox,
        idleTimeoutMs: opts.idleTimeoutMs,
      });
      this.supportsDeltaPrompts = true;
    } else {
      // Default: persistent `codex app-server` JSON-RPC process — one
      // long-lived thread per debate, no per-turn CLI startup.
      this.transport = createAppServerTransport({
        model: opts.model,
        reasoningEffort: opts.reasoningEffort,
        cwd: opts.cwd,
        sandbox: opts.sandbox,
        idleTimeoutMs: opts.idleTimeoutMs,
      });
      this.supportsDeltaPrompts = true;
    }
  }

  async *stream(
    ctx: TurnContext,
    signal: AbortSignal,
  ): AsyncGenerator<Token, StreamTail | void, void> {
    const generation = this.transport.sessionGeneration();
    const sessionStillAlive =
      this.hasSessionContext && generation === this.seededGeneration;
    // We HAD a seeded session and lost it (child died / was killed between
    // turns) — recovery is automatic via the full prompt, but the user
    // should know the CLI's conversation context was rebuilt.
    const contextWasReset = this.hasSessionContext && !sessionStillAlive;
    const useDelta =
      this.supportsDeltaPrompts && sessionStillAlive && !!ctx.deltaPrompt;

    // Always prepend system instructions on full (non-delta) prompts.
    // Delta prompts omit them — the persistent session already has them.
    const rawPrompt = useDelta ? ctx.deltaPrompt! : ctx.prompt;
    const prompt = useDelta
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

    // Guarded on supportsDeltaPrompts: legacy per-turn transports bump the
    // generation every turn by design — that's not a lost session.
    const notice =
      contextWasReset && this.supportsDeltaPrompts
        ? 'codex session restarted — context reseeded with a full prompt'
        : undefined;

    if (subprocessError && fullText.length === 0) {
      const errMsg = `⚠ codex subprocess failed: ${subprocessError}`;
      yield { text: errMsg };
      return {
        raw: JSON.stringify({ commentary: errMsg }),
        usage,
        notice,
      };
    }
    return { raw: fullText, usage, notice };
  }

  dispose() {
    this.hasSessionContext = false;
    this.transport.dispose();
  }
}
