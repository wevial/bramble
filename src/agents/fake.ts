import type { Agent, AgentName, Token, TurnContext } from './agent.js';

export class FakeAgent implements Agent {
  readonly name: AgentName;
  private response = '';
  private tokenDelayMs = 0;

  constructor(name: AgentName) {
    this.name = name;
  }

  setResponse(text: string): void {
    this.response = text;
  }

  setTokenDelayMs(ms: number): void {
    this.tokenDelayMs = ms;
  }

  async *stream(_ctx: TurnContext, signal: AbortSignal): AsyncIterable<Token> {
    for (const ch of this.response) {
      if (signal.aborted) return;
      if (this.tokenDelayMs > 0) {
        await sleep(this.tokenDelayMs, signal);
        if (signal.aborted) return;
      }
      yield { text: ch };
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
