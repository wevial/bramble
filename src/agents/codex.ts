import type { Agent, AgentName, StreamTail, Token, TurnContext, TurnUsage } from './agent.js';
import { streamProcessLines, type SpawnSpec } from './subprocess.js';
import { parseCodexEvent } from './codex-events.js';
import { systemInstructions } from '../prompts/system.js';

export type CodexAgentOptions = {
  /** Override the line-stream source for testing. Default spawns `codex`. */
  streamLines?: (prompt: string, signal: AbortSignal) => AsyncIterable<string>;
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
};

export function codexSpawnSpec(
  prompt: string,
  opts: { model?: string; reasoningEffort?: string; cwd?: string } = {},
): SpawnSpec {
  const args = ['exec', '--json'];
  if (opts.model) args.push('-m', opts.model);
  if (opts.reasoningEffort) {
    args.push('-c', `model_reasoning_effort=${opts.reasoningEffort}`);
  }
  args.push(prompt);
  const spec: SpawnSpec = { cmd: 'codex', args };
  if (opts.cwd) spec.cwd = opts.cwd;
  return spec;
}

const DEFAULT_PROTOCOL = systemInstructions('codex');

function defaultSpawn(
  prompt: string,
  signal: AbortSignal,
  model: string | undefined,
  reasoningEffort: string | undefined,
  cwd: string | undefined,
): AsyncIterable<string> {
  return streamProcessLines(
    codexSpawnSpec(prompt, { model, reasoningEffort, cwd }),
    signal,
  );
}

export class CodexAgent implements Agent {
  readonly name: AgentName = 'codex';
  private readonly streamLines: (
    prompt: string,
    signal: AbortSignal,
  ) => AsyncIterable<string>;
  private readonly systemInstructions: string;

  constructor(opts: CodexAgentOptions = {}) {
    this.streamLines =
      opts.streamLines ??
      ((p, s) =>
        defaultSpawn(p, s, opts.model, opts.reasoningEffort, opts.cwd));
    this.systemInstructions = opts.systemInstructions ?? DEFAULT_PROTOCOL;
  }

  async *stream(
    ctx: TurnContext,
    signal: AbortSignal,
  ): AsyncGenerator<Token, StreamTail | void, void> {
    const prompt = `${this.systemInstructions}\n\n---\n\n${ctx.prompt}`;
    let fullText = '';
    let usage: TurnUsage | undefined;
    let subprocessError: string | null = null;

    try {
      for await (const line of this.streamLines(prompt, signal)) {
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
    // Codex spawns a fresh subprocess per turn, so there's no full-vs-delta
    // distinction to report — leave the claude-only debug fields off.
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
}
