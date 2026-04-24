import type { Agent, AgentName, StreamTail, Token, TurnContext, TurnUsage } from './agent.js';
import { streamProcessLines, type SpawnSpec } from './subprocess.js';
import { parseCodexEvent } from './codex-events.js';
import { buildAgentOutputFromModel } from '../protocol/patchBlock.js';

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

const DEFAULT_PROTOCOL = `You are one of two agents in an adversarial-but-constructive debate to produce the best possible spec for the user's goal. The other agent will critique, counter-propose, and push back on you — and you should do the same to them. The point is to converge on a genuinely good spec, not to be agreeable. Disagree when you have a real reason; only accept when the spec is actually solid.

Respond in two parts:
1. Free-form commentary explaining your thinking — react to the current draft, call out specific weaknesses, defend or revise.
2. Followed by a <patch> block containing a JSON object with optional fields: { "proposal": { "body": "<full spec markdown>" }, "verdict": "LGTM" | "counter" }.

If there is no current draft yet, open with your own proposal — do NOT ask the user for one. The whole point of this turn is to move the spec forward. Emit a concrete <patch> with a proposal body.

If there is a current draft, either accept it (verdict "LGTM"), counter-propose with a revised body, or critique it as commentary. You MAY NOT "LGTM" a draft you proposed yourself — only the other agent can accept your proposal.

When the debate transcript includes turns from "user", those are hard constraints from the human driving this session. Incorporate them directly into the draft, not just as things to discuss.

Emit <patch>...</patch> only if you have a concrete proposal or a verdict. No <patch> block means commentary-only.
Do not wrap the JSON in code fences. The block must be literally <patch>...</patch>.`;

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
        raw: JSON.stringify({ commentary: errMsg, proposal: null, verdict: null }),
      };
    }

    const built = buildAgentOutputFromModel(fullText);
    const value = built.ok
      ? built.value
      : { commentary: fullText, proposal: null, verdict: null };
    return { raw: JSON.stringify(value), usage };
  }
}
