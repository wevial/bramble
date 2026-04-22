import type { Agent, AgentName, StreamTail, Token, TurnContext } from './agent.js';
import { streamProcessLines } from './subprocess.js';
import { parseClaudeEvent } from './claude-events.js';
import { buildAgentOutputFromModel } from '../protocol/patchBlock.js';

export type ClaudeAgentOptions = {
  /** Override the line-stream source for testing. Default spawns `claude`. */
  streamLines?: (prompt: string, signal: AbortSignal) => AsyncIterable<string>;
  /** Appended to the user prompt. Defaults to the patch-protocol instructions. */
  systemInstructions?: string;
  /** Pinned model id (e.g. "claude-sonnet-4-6"). Default uses the CLI default. */
  model?: string;
};

const DEFAULT_PROTOCOL = `You are one of two collaborators in a spec-writing debate. Respond in two parts:
1. Free-form commentary explaining your thinking, reacting to the current draft, proposing or critiquing.
2. Followed by a <patch> block containing a JSON object with optional fields: { "proposal": { "body": "<full spec markdown>" }, "verdict": "LGTM" | "counter" }.

If there is no current draft yet, open with your own proposal — do NOT ask the user for one. The whole point of this turn is to move the spec forward. Emit a concrete <patch> with a proposal body.

If there is a current draft, either accept it (verdict "LGTM"), counter-propose with a revised body, or critique it as commentary.

Emit <patch>...</patch> only if you have a concrete proposal or a verdict. No <patch> block means commentary-only.
Do not wrap the JSON in code fences. The block must be literally <patch>...</patch>.`;

function defaultSpawn(
  prompt: string,
  signal: AbortSignal,
  model: string | undefined,
): AsyncIterable<string> {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];
  if (model) args.push('--model', model);
  return streamProcessLines({ cmd: 'claude', args }, signal);
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
      opts.streamLines ?? ((p, s) => defaultSpawn(p, s, opts.model));
    this.systemInstructions = opts.systemInstructions ?? DEFAULT_PROTOCOL;
  }

  async *stream(
    ctx: TurnContext,
    signal: AbortSignal,
  ): AsyncGenerator<Token, StreamTail | void, void> {
    const prompt = `${this.systemInstructions}\n\n---\n\n${ctx.prompt}`;
    let accumulated = '';
    let finalResult: string | null = null;

    for await (const line of this.streamLines(prompt, signal)) {
      if (signal.aborted) break;
      const evt = parseClaudeEvent(line);
      if (evt === null) continue;
      if (evt.kind === 'text') {
        accumulated += evt.text;
        yield { text: evt.text };
      } else {
        // kind: 'result'
        finalResult = evt.result;
      }
    }

    const fullText = finalResult ?? accumulated;
    const built = buildAgentOutputFromModel(fullText);
    const value = built.ok
      ? built.value
      : { commentary: fullText, proposal: null, verdict: null };
    return { raw: JSON.stringify(value) };
  }
}
