import type { Agent, AgentName, StreamTail, Token, TurnContext } from './agent.js';

export type FakeInterviewResponse = {
  kind: 'interview';
  commentary: string;
  question?: string | null;
  ready?: boolean;
};

export type FakeDebateResponse = {
  kind: 'debate';
  commentary: string;
  edits?: Array<{ find: string; replace: string }>;
  verdict?: 'continue' | 'lgtm';
};

/** Plain string responses are treated as raw output (commentary-only). */
export type FakeResponse =
  | string
  | FakeInterviewResponse
  | FakeDebateResponse;

export class FakeAgent implements Agent {
  readonly name: AgentName;
  private responses: FakeResponse[] = [''];
  private turnIdx = 0;
  private tokenDelayMs = 0;

  constructor(name: AgentName) {
    this.name = name;
  }

  setResponse(text: FakeResponse): void {
    this.responses = [text];
    this.turnIdx = 0;
  }

  /** Cycle through this list, one entry per turn. The last entry repeats. */
  setResponses(list: FakeResponse[]): void {
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

    const { displayText, raw } = renderFakeResponse(response);

    for (const ch of displayText) {
      if (signal.aborted) return;
      if (this.tokenDelayMs > 0) {
        await sleep(this.tokenDelayMs, signal);
        if (signal.aborted) return;
      }
      yield { text: ch };
    }

    if (raw !== null) return { raw };
  }
}

function renderFakeResponse(r: FakeResponse): {
  displayText: string;
  raw: string | null;
} {
  if (typeof r === 'string') return { displayText: r, raw: null };
  if (r.kind === 'interview') {
    const body = {
      commentary: r.commentary,
      question: r.question ?? null,
      ready: r.ready ?? false,
    };
    return { displayText: r.commentary, raw: JSON.stringify(body) };
  }
  // debate
  const body = {
    commentary: r.commentary,
    edits: r.edits ?? [],
    verdict: r.verdict ?? 'continue',
  };
  return { displayText: r.commentary, raw: JSON.stringify(body) };
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
