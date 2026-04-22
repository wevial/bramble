import type { Agent } from '../agents/agent.js';
import { appendTurn } from '../docs/transcript.js';
import { reducer } from './reducer.js';
import { nextSpeaker } from './scheduler.js';
import { initialState, type State } from './types.js';

export type RunDebateOptions = {
  agents: { claude: Agent; codex: Agent };
  prompt: string;
  rounds: number;
  transcriptPath: string;
  onToken?: (speaker: 'claude' | 'codex', text: string) => void;
  signal?: AbortSignal;
};

export async function runDebate(opts: RunDebateOptions): Promise<State> {
  let state: State = { ...initialState };
  const totalTurns = opts.rounds * 2;

  for (let i = 0; i < totalTurns; i++) {
    if (opts.signal?.aborted) break;
    const speaker = nextSpeaker(state);
    const agent = opts.agents[speaker];
    state = reducer(state, { type: 'turnStarted', speaker });

    const turnController = new AbortController();
    opts.signal?.addEventListener('abort', () => turnController.abort(), { once: true });

    let content = '';
    for await (const token of agent.stream({ prompt: opts.prompt }, turnController.signal)) {
      content += token.text;
      opts.onToken?.(speaker, token.text);
    }

    const timestamp = new Date().toISOString();
    state = reducer(state, { type: 'turnCompleted', speaker, content, timestamp });
    await appendTurn(opts.transcriptPath, { speaker, content, timestamp });
  }

  return state;
}
