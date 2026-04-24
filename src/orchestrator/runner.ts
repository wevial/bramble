import type { Agent } from '../agents/agent.js';
import { appendTurn } from '../docs/transcript.js';
import { parseAgentOutput } from '../protocol/patch.js';
import { reducer } from './reducer.js';
import { nextSpeaker } from './scheduler.js';
import { initialState, type State } from './types.js';

export type DebateMode = 'auto' | 'collab';

export type RunDebateOptions = {
  agents: { claude: Agent; codex: Agent };
  prompt: string;
  rounds: number;
  transcriptPath: string;
  /** Optional starting state — used for --resume. Defaults to initialState. */
  initialState?: State;
  /** Debate cadence: "auto" runs turns back-to-back, "collab" pauses between. */
  mode?: DebateMode;
  onToken?: (speaker: 'claude' | 'codex', text: string) => void;
  onState?: (state: State) => void;
  /** Fired whenever the collab-mode pause state changes. */
  onPauseChange?: (paused: boolean) => void;
  signal?: AbortSignal;
};

export type DebateHandle = {
  /** Resolves with the final state when the debate ends. */
  done: Promise<State>;
  /** Cancel an in-flight turn and record a user turn; next agent sees it in context. */
  interject(content: string): void;
  /** Abort the whole debate. */
  abort(): void;
  /** Update the round cap at runtime; takes effect on the next loop iteration. */
  setRounds(n: number): void;
  /** Current round cap. */
  getRounds(): number;
  /** In collab mode, advance past the current between-turns pause. No-op in auto mode. */
  continue(): void;
};

export function startDebate(opts: RunDebateOptions): DebateHandle {
  let state: State = opts.initialState ?? { ...initialState };
  let turnController: AbortController | null = null;
  let rounds = Math.max(1, Math.floor(opts.rounds));
  const mode: DebateMode = opts.mode ?? 'auto';
  let continueResolver: (() => void) | null = null;
  const outer = new AbortController();
  opts.signal?.addEventListener('abort', () => outer.abort(), { once: true });

  const resumePause = () => {
    if (continueResolver) {
      const r = continueResolver;
      continueResolver = null;
      opts.onPauseChange?.(false);
      r();
    }
  };

  const interject = (content: string) => {
    const timestamp = new Date().toISOString();
    state = reducer(state, { type: 'userInterjection', content, timestamp });
    opts.onState?.(state);
    void appendTurn(opts.transcriptPath, { speaker: 'user', content, timestamp });
    turnController?.abort();
    // In collab mode, a user interjection also wakes the between-turns pause
    // so the next agent picks up the new context immediately.
    resumePause();
  };

  const done = (async () => {
    // Surface any resumed state so the UI renders the prior transcript
    // before the first new turn begins.
    if (state.transcript.length > 0 || state.currentDraft !== null) {
      opts.onState?.(state);
    }
    let i = 0;
    // Accept short-circuit for already-accepted resumes: no more turns needed.
    if (state.accepted) return state;
    while (i < rounds * 2) {
      if (outer.signal.aborted) break;
      const speaker = nextSpeaker(state);
      const agent = opts.agents[speaker];
      state = reducer(state, { type: 'turnStarted', speaker });
      opts.onState?.(state);

      turnController = new AbortController();
      outer.signal.addEventListener('abort', () => turnController?.abort(), { once: true });

      const prompt = buildPrompt(opts.prompt, state, speaker, mode);
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
      i++;
      // Collab mode: pause between turns (unless this was the final turn or
      // a terminal verdict landed).
      if (
        mode === 'collab' &&
        i < rounds * 2 &&
        !state.accepted &&
        !outer.signal.aborted
      ) {
        opts.onPauseChange?.(true);
        await new Promise<void>(resolve => {
          continueResolver = resolve;
          outer.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        opts.onPauseChange?.(false);
      }
    }
    return state;
  })();

  return {
    done,
    interject,
    abort: () => outer.abort(),
    setRounds: (n: number) => {
      rounds = Math.max(1, Math.floor(n));
    },
    getRounds: () => rounds,
    continue: resumePause,
  };
}

export async function runDebate(opts: RunDebateOptions): Promise<State> {
  return startDebate(opts).done;
}

export function buildPrompt(
  basePrompt: string,
  state: State,
  speaker: 'claude' | 'codex',
  mode: DebateMode,
): string {
  const other = speaker === 'claude' ? 'codex' : 'claude';
  const parts: string[] = [];

  parts.push(
    `# Your role\n\nYou are ${speaker}, debating ${other} to converge on the best possible spec for the goal below. This is an adversarial-but-constructive debate: disagree when you have a real reason, and don't rubber-stamp a draft just to be agreeable. When you eventually accept, it should be because the spec is genuinely solid.`,
  );

  parts.push(`# Goal\n\n${basePrompt}`);

  const userTurns = state.transcript.filter(t => t.speaker === 'user');
  if (userTurns.length > 0) {
    parts.push(
      `# User guidance\n\nThe human driving this session has added the following. Treat these as hard constraints — incorporate them directly into the spec, not just as things to discuss.\n\n${userTurns
        .map(t => `- ${t.content}`)
        .join('\n')}`,
    );
  }

  if (state.currentDraft) {
    const authorTag =
      state.currentDraft.proposer === speaker ? ' — yours' : '';
    parts.push(
      `# Current draft (by ${state.currentDraft.proposer}${authorTag})\n\n${state.currentDraft.body}`,
    );
  }

  const debateTurns = state.transcript.filter(
    t => t.speaker === 'claude' || t.speaker === 'codex',
  );
  if (debateTurns.length > 0) {
    const lines = debateTurns.map(t => `## ${t.speaker}\n\n${t.content}`);
    parts.push(`# Debate so far\n\n${lines.join('\n\n')}`);
  }

  parts.push(`# Your turn\n\n${turnGuidance(state, speaker, mode)}`);
  return parts.join('\n\n');
}

function turnGuidance(
  state: State,
  speaker: 'claude' | 'codex',
  mode: DebateMode,
): string {
  const other = speaker === 'claude' ? 'codex' : 'claude';
  const draft = state.currentDraft;
  const sections: string[] = [];

  if (!draft) {
    sections.push(
      `No draft exists yet. Open with a concrete proposal — emit a <patch> with a full spec body. Don't critique in the abstract; show the shape you want.`,
    );
  } else if (draft.proposer === speaker) {
    sections.push(
      `The current draft is yours, so you can't LGTM it — only ${other} can accept your proposal. React to ${other}'s latest critique: either revise with a new <patch> body that addresses it, or defend your design in commentary if you think they're wrong.`,
    );
  } else {
    sections.push(
      `${other} proposed the current draft. Pick one:
- LGTM if it's genuinely solid (verdict "LGTM" — this ends the debate).
- Counter-propose with a revised body via a <patch> (verdict "counter").
- Critique it as commentary without a <patch> if you want to push back before rewriting.`,
    );
  }

  if (mode === 'collab') {
    sections.push(
      `This session is in collab mode: a human is reviewing between turns and may interject with constraints or redirects. If any appear under "User guidance", reflect them directly in your response — don't wait for the next turn.`,
    );
  }

  return sections.join('\n\n');
}
