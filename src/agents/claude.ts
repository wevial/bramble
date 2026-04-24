import type { Agent, AgentName, StreamTail, Token, TurnContext, TurnUsage } from './agent.js';
import { streamProcessLines, type SpawnSpec } from './subprocess.js';
import { parseClaudeEvent } from './claude-events.js';
import { buildAgentOutputFromModel } from '../protocol/patchBlock.js';

export type ClaudeAgentOptions = {
  /** Override the line-stream source for testing. Default spawns `claude`. */
  streamLines?: (prompt: string, signal: AbortSignal) => AsyncIterable<string>;
  /** Appended to the user prompt. Defaults to the patch-protocol instructions. */
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
};

export function claudeSpawnSpec(
  prompt: string,
  opts: { model?: string; reasoningEffort?: string; cwd?: string } = {},
): SpawnSpec {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];
  if (opts.model) args.push('--model', opts.model);
  if (opts.reasoningEffort) args.push('--effort', opts.reasoningEffort);
  const spec: SpawnSpec = { cmd: 'claude', args };
  if (opts.cwd) spec.cwd = opts.cwd;
  return spec;
}

const DEFAULT_PROTOCOL = `You are one of two agents in an adversarial-but-constructive debate to produce the best possible spec for the user's goal. The other agent will critique, counter-propose, and push back on you — and you should do the same to them. The point is to converge on a genuinely good spec, not to be agreeable. Disagree when you have a real reason; only accept when the spec is actually solid.

Respond in two parts:
1. Free-form commentary explaining your thinking — react to the current draft, call out specific weaknesses, defend or revise.
2. Followed by a <patch> block containing a JSON object with optional fields: { "proposal": { "body": "<full spec markdown>" }, "verdict": "LGTM" | "counter" }.

If there is no current draft yet, open with your own proposal — do NOT ask the user for one. The whole point of this turn is to move the spec forward. Emit a concrete <patch> with a proposal body.

If there is a current draft, either accept it (verdict "LGTM"), counter-propose with a revised body, or critique it as commentary. You MAY NOT "LGTM" a draft you proposed yourself — only the other agent can accept your proposal.

When the per-turn prompt includes "User guidance", those are hard constraints from the human driving this session. Incorporate them directly into the draft, not just as things to discuss.

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
    claudeSpawnSpec(prompt, { model, reasoningEffort, cwd }),
    signal,
  );
}

export class ClaudeAgent implements Agent {
  readonly name: AgentName = 'claude';
  private readonly streamLines: (
    prompt: string,
    signal: AbortSignal,
  ) => AsyncIterable<string>;
  private readonly systemInstructions: string;

  constructor(opts: ClaudeAgentOptions = {}) {
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
    let accumulated = '';
    let finalResult: string | null = null;
    let usage: TurnUsage | undefined;
    let subprocessError: string | null = null;

    try {
      for await (const line of this.streamLines(prompt, signal)) {
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

    if (subprocessError && !finalResult && accumulated.length === 0) {
      const errMsg = `⚠ claude subprocess failed: ${subprocessError}`;
      yield { text: errMsg };
      return {
        raw: JSON.stringify({ commentary: errMsg, proposal: null, verdict: null }),
      };
    }

    const fullText = finalResult ?? accumulated;
    const built = buildAgentOutputFromModel(fullText);
    const value = built.ok
      ? built.value
      : { commentary: fullText, proposal: null, verdict: null };
    return { raw: JSON.stringify(value), usage };
  }
}
