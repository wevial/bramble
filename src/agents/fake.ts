import type { Agent, AgentName, StreamTail, Token, TurnContext } from './agent.js';

export type StructuredResponse = {
  commentary: string;
  proposal?: { body: string };
  verdict?: 'LGTM' | 'counter';
};

export class FakeAgent implements Agent {
  readonly name: AgentName;
  private responses: Array<string | StructuredResponse> = [''];
  private turnIdx = 0;
  private tokenDelayMs = 0;

  constructor(name: AgentName) {
    this.name = name;
  }

  setResponse(text: string | StructuredResponse): void {
    this.responses = [text];
    this.turnIdx = 0;
  }

  /** Cycle through this list, one entry per turn. The last entry repeats. */
  setResponses(list: Array<string | StructuredResponse>): void {
    if (list.length === 0) throw new Error('setResponses: empty list');
    this.responses = list;
    this.turnIdx = 0;
  }

  setTokenDelayMs(ms: number): void {
    this.tokenDelayMs = ms;
  }

  async *stream(
    _ctx: TurnContext,
    signal: AbortSignal,
  ): AsyncGenerator<Token, StreamTail | void, void> {
    const response =
      this.responses[Math.min(this.turnIdx, this.responses.length - 1)]!;
    this.turnIdx += 1;
    const isStructured = typeof response !== 'string';
    const displayText = isStructured
      ? (response as StructuredResponse).commentary
      : (response as string);

    for (const ch of displayText) {
      if (signal.aborted) return;
      if (this.tokenDelayMs > 0) {
        await sleep(this.tokenDelayMs, signal);
        if (signal.aborted) return;
      }
      yield { text: ch };
    }

    if (isStructured) {
      const r = response as StructuredResponse;
      const raw = JSON.stringify({
        commentary: r.commentary,
        proposal: r.proposal ?? null,
        verdict: r.verdict ?? null,
      });
      return { raw };
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
