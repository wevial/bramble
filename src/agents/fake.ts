import type { Agent, AgentName, StreamTail, Token, TurnContext } from './agent.js';

export type StructuredResponse = {
  commentary: string;
  proposal?: { body: string };
  verdict?: 'LGTM' | 'counter';
};

export class FakeAgent implements Agent {
  readonly name: AgentName;
  private response: string | StructuredResponse = '';
  private tokenDelayMs = 0;

  constructor(name: AgentName) {
    this.name = name;
  }

  setResponse(text: string | StructuredResponse): void {
    this.response = text;
  }

  setTokenDelayMs(ms: number): void {
    this.tokenDelayMs = ms;
  }

  async *stream(
    _ctx: TurnContext,
    signal: AbortSignal,
  ): AsyncGenerator<Token, StreamTail | void, void> {
    const isStructured = typeof this.response !== 'string';
    const displayText = isStructured
      ? (this.response as StructuredResponse).commentary
      : (this.response as string);

    for (const ch of displayText) {
      if (signal.aborted) return;
      if (this.tokenDelayMs > 0) {
        await sleep(this.tokenDelayMs, signal);
        if (signal.aborted) return;
      }
      yield { text: ch };
    }

    if (isStructured) {
      const r = this.response as StructuredResponse;
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
