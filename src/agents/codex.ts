import type { Agent, AgentName, StreamTail, Token, TurnContext } from './agent.js';
import { streamProcessLines } from './subprocess.js';
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
};

const DEFAULT_PROTOCOL = `You are one of two collaborators in a spec-writing debate. Respond in two parts:
1. Free-form commentary explaining your thinking, reacting to the current draft, proposing or critiquing.
2. Followed by a <patch> block containing a JSON object with optional fields: { "proposal": { "body": "<full spec markdown>" }, "verdict": "LGTM" | "counter" }.

Emit <patch>...</patch> only if you have a concrete proposal or a verdict. No <patch> block means commentary-only.
Do not wrap the JSON in code fences. The block must be literally <patch>...</patch>.`;

function defaultSpawn(
  prompt: string,
  signal: AbortSignal,
  model: string | undefined,
  reasoningEffort: string | undefined,
): AsyncIterable<string> {
  const args = ['exec', '--json'];
  if (model) args.push('-m', model);
  if (reasoningEffort) {
    args.push('-c', `model_reasoning_effort=${reasoningEffort}`);
  }
  args.push(prompt);
  return streamProcessLines({ cmd: 'codex', args }, signal);
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
      ((p, s) => defaultSpawn(p, s, opts.model, opts.reasoningEffort));
    this.systemInstructions = opts.systemInstructions ?? DEFAULT_PROTOCOL;
  }

  async *stream(
    ctx: TurnContext,
    signal: AbortSignal,
  ): AsyncGenerator<Token, StreamTail | void, void> {
    const prompt = `${this.systemInstructions}\n\n---\n\n${ctx.prompt}`;
    let fullText = '';

    for await (const line of this.streamLines(prompt, signal)) {
      if (signal.aborted) break;
      const evt = parseCodexEvent(line);
      if (evt === null) continue;
      if (evt.kind === 'message') {
        fullText += evt.text;
        yield { text: evt.text };
      }
      // kind: 'turnDone' — end marker; subprocess will close shortly.
    }

    const built = buildAgentOutputFromModel(fullText);
    if (built.ok) return { raw: JSON.stringify(built.value) };
    return {
      raw: JSON.stringify({
        commentary: fullText,
        proposal: null,
        verdict: null,
      }),
    };
  }
}
