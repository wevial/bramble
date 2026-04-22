import type { Agent } from '../agents/agent.js';
import { appendTurn } from '../docs/transcript.js';
import { parseAgentOutput } from '../protocol/patch.js';
import { reducer } from './reducer.js';
import { nextSpeaker } from './scheduler.js';
import { initialState, type State } from './types.js';

export type RunDebateOptions = {
  agents: { claude: Agent; codex: Agent };
  prompt: string;
  rounds: number;
  transcriptPath: string;
  onToken?: (speaker: 'claude' | 'codex', text: string) => void;
  onState?: (state: State) => void;
  signal?: AbortSignal;
};

export type DebateHandle = {
  /** Resolves with the final state when the debate ends. */
  done: Promise<State>;
  /** Cancel an in-flight turn and record a user turn; next agent sees it in context. */
  interject(content: string): void;
  /** Abort the whole debate. */
  abort(): void;
};

export function startDebate(opts: RunDebateOptions): DebateHandle {
  let state: State = { ...initialState };
  let turnController: AbortController | null = null;
  const outer = new AbortController();
  opts.signal?.addEventListener('abort', () => outer.abort(), { once: true });

  const interject = (content: string) => {
    const timestamp = new Date().toISOString();
    state = reducer(state, { type: 'userInterjection', content, timestamp });
    opts.onState?.(state);
    void appendTurn(opts.transcriptPath, { speaker: 'user', content, timestamp });
    turnController?.abort();
  };

  const done = (async () => {
    const totalTurns = opts.rounds * 2;
    for (let i = 0; i < totalTurns; i++) {
      if (outer.signal.aborted) break;
      const speaker = nextSpeaker(state);
      const agent = opts.agents[speaker];
      state = reducer(state, { type: 'turnStarted', speaker });
      opts.onState?.(state);

      turnController = new AbortController();
      outer.signal.addEventListener('abort', () => turnController?.abort(), { once: true });

      const prompt = buildPrompt(opts.prompt, state);
      let displayed = '';
      let rawTail: string | undefined;
      try {
        const iter = agent.stream({ prompt }, turnController.signal);
        while (true) {
          const r = await iter.next();
          if (r.done) {
            if (r.value) rawTail = r.value.raw;
            break;
          }
          displayed += r.value.text;
          opts.onToken?.(speaker, r.value.text);
        }
      } catch {
        // aborts may throw; treat whatever we collected as the turn's content
      }
      // Wire content is the structured raw tail when the agent provides one
      // (e.g. JSON patch); otherwise whatever streamed.
      const content = rawTail ?? displayed;

      const timestamp = new Date().toISOString();
      state = reducer(state, { type: 'turnCompleted', speaker, content, timestamp });
      opts.onState?.(state);
      await appendTurn(opts.transcriptPath, { speaker, content, timestamp });

      // Parse structured output and dispatch proposal/verdict if present.
      const parsed = parseAgentOutput(content, { fallbackToCommentary: true });
      if (parsed.ok) {
        if (parsed.value.proposal) {
          state = reducer(state, {
            type: 'proposalReceived',
            speaker,
            body: parsed.value.proposal.body,
          });
          opts.onState?.(state);
        }
        if (parsed.value.verdict) {
          state = reducer(state, {
            type: 'verdictReceived',
            speaker,
            verdict: parsed.value.verdict,
          });
          opts.onState?.(state);
          if (state.accepted) break;
        }
      }
    }
    return state;
  })();

  return {
    done,
    interject,
    abort: () => outer.abort(),
  };
}

export async function runDebate(opts: RunDebateOptions): Promise<State> {
  return startDebate(opts).done;
}

function buildPrompt(basePrompt: string, state: State): string {
  const userTurns = state.transcript.filter(t => t.speaker === 'user');
  if (userTurns.length === 0) return basePrompt;
  const userNotes = userTurns.map(t => `- ${t.content}`).join('\n');
  return `${basePrompt}\n\nUser constraints:\n${userNotes}`;
}
