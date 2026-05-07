import type { Agent, TurnUsage } from '../agents/agent.js';
import type { Persona, PersonaId } from '../personas/personas.js';
import { defaultPersonas } from '../personas/personas.js';
import {
  parseDebateMessage,
  parseInterviewMessage,
} from '../protocol/messages.js';
import { interviewPrompt } from '../prompts/interview.js';
import { debatePrompt } from '../prompts/debate.js';
import { reducer, type State, type DebateConfig, initialState } from './state.js';
import { nextSpeaker } from './scheduler.js';
import { appendEntry } from '../docs/transcript.js';

export type DebateMode = 'auto' | 'collab';

export type RunOptions = {
  /**
   * Map from persona ID to the Agent that backs it. The legacy shape
   * `{ claude, codex }` still works since both are valid persona IDs.
   * For richer sessions with specialists, pass each persona's backing
   * agent here keyed by its ID.
   */
  agents: Record<PersonaId, Agent>;
  /**
   * Personas active in this session, in scheduling order. Defaults to
   * `[CLAUDE_PERSONA, CODEX_PERSONA]` for backward compatibility.
   */
  personas?: Persona[];
  prompt: string;
  /**
   * Override the default debate config (rounds cap, decay threshold/window).
   * Saved into state.config and replayable via the transcript.
   */
  config?: Partial<DebateConfig>;
  transcriptPath: string;
  /** When provided, skips writing the initial 'session' transcript entry. */
  initialState?: State;
  mode?: DebateMode;
  onToken?: (speaker: PersonaId, text: string) => void;
  onState?: (state: State) => void;
  onUsage?: (speaker: PersonaId, usage: TurnUsage) => void;
  onPauseChange?: (paused: boolean) => void;
  signal?: AbortSignal;
};

export type RunHandle = {
  done: Promise<State>;
  /** During interview: feeds the user's answer to the next agent. During debate: appends as a constraint and aborts current turn. */
  interject(content: string): void;
  abort(): void;
  /** Force the interview phase to end and start the debate. */
  done_interview(): void;
  /** Live tweak to debate config. */
  updateConfig(patch: Partial<DebateConfig>): void;
  /** Replace the spec body wholesale (e.g., after an external editor session). */
  userEdit(newSpec: string): void;
  /**
   * Append user-supplied context without consuming the current wait or
   * aborting an active turn. Useful for adding details mid-interview without
   * "answering" the pending question, or noting constraints during debate
   * without interrupting the speaker.
   */
  addContext(content: string): void;
  /** In collab mode, advance past a between-turns pause. */
  continue(): void;
};

export function startDebate(opts: RunOptions): RunHandle {
  const personas = opts.personas ?? defaultPersonas();
  const personaIds = personas.map(p => p.id);
  let state: State =
    opts.initialState ??
    initialState(opts.prompt, opts.config, personaIds);
  const mode: DebateMode = opts.mode ?? 'auto';
  const outer = new AbortController();
  opts.signal?.addEventListener('abort', () => outer.abort(), { once: true });

  let turnController: AbortController | null = null;
  let userAnswerResolver: ((content: string | null) => void) | null = null;
  let collabPauseResolver: (() => void) | null = null;
  let signoffResolver: (() => void) | null = null;
  // Buffer for user input that arrives during interview while the agent is
  // mid-stream (no resolver waiting yet). Delivered at the next wait point so
  // we don't abort the agent's in-flight question.
  let pendingUserAnswer: string | null = null;

  let disposed = false;
  const disposeAgents = () => {
    if (disposed) return;
    disposed = true;
    // Dedupe: the same Agent instance may back multiple personas (e.g. a
    // shared claude transport powering ClaudePersona + SecurityCritic).
    const seen = new Set<Agent>();
    for (const id of personaIds) {
      const a = opts.agents[id];
      if (!a || seen.has(a)) continue;
      seen.add(a);
      try { a.dispose?.(); } catch { /* ignore */ }
    }
  };
  outer.signal.addEventListener('abort', disposeAgents, { once: true });

  // Serialize all transcript writes through a chain so the order on disk
  // matches the order events were emitted. appendEntry itself is async and
  // fire-and-forget would let later events land on disk before the initial
  // 'session' entry, breaking rehydrateState().
  let transcriptWrites: Promise<void> = Promise.resolve();
  const queueAppend = (entry: Parameters<typeof appendEntry>[1]): void => {
    transcriptWrites = transcriptWrites.then(() =>
      appendEntry(opts.transcriptPath, entry).catch(() => {}),
    );
  };

  if (!opts.initialState) {
    queueAppend({
      type: 'session',
      prompt: state.prompt,
      config: state.config,
      timestamp: new Date().toISOString(),
    });
  }

  const dispatch = (action: Parameters<typeof reducer>[1]): void => {
    state = reducer(state, action);
    opts.onState?.(state);
  };

  const interject = (content: string): void => {
    // Interview waiting: deliver answer, dispatch userAnswer.
    if (state.phase === 'interview' && userAnswerResolver) {
      const r = userAnswerResolver;
      userAnswerResolver = null;
      const ts = new Date().toISOString();
      dispatch({ type: 'userAnswer', content, timestamp: ts });
      queueAppend({
        type: 'user_answer',
        content,
        timestamp: ts,
      });
      r(content);
      return;
    }
    // Interview, but no resolver is waiting yet (agent still streaming). Queue
    // the answer; the upcoming wait point will pick it up. Do NOT abort the
    // turn — the agent is mid-question and aborting would lose its output.
    if (state.phase === 'interview') {
      const ts = new Date().toISOString();
      pendingUserAnswer = content;
      dispatch({ type: 'userAnswer', content, timestamp: ts });
      queueAppend({
        type: 'user_answer',
        content,
        timestamp: ts,
      });
      return;
    }
    // Debate: log the constraint and abort the active turn so the next agent
    // sees it.
    const ts = new Date().toISOString();
    dispatch({ type: 'userAnswer', content, timestamp: ts });
    queueAppend({
      type: 'user_answer',
      content,
      timestamp: ts,
    });
    turnController?.abort();
    if (collabPauseResolver) {
      const r = collabPauseResolver;
      collabPauseResolver = null;
      opts.onPauseChange?.(false);
      r();
    }
    // Any user input during the post-LGTM signoff pause re-opens the debate.
    // The reducer cleared awaitingSignoff above; release the runner's wait.
    if (signoffResolver) {
      const r = signoffResolver;
      signoffResolver = null;
      r();
    }
  };

  const doneInterview = (): void => {
    // Reused for /done: ends the interview, OR finalizes the signoff pause
    // after mutual LGTM.
    if (state.phase === 'interview') {
      dispatch({ type: 'userDone' });
      queueAppend({
        type: 'user_done',
        timestamp: new Date().toISOString(),
      });
      if (userAnswerResolver) {
        const r = userAnswerResolver;
        userAnswerResolver = null;
        r(null);
      }
      return;
    }
    if (state.phase === 'debate' && state.awaitingSignoff) {
      dispatch({ type: 'userDone' });
      queueAppend({
        type: 'user_done',
        timestamp: new Date().toISOString(),
      });
      if (signoffResolver) {
        const r = signoffResolver;
        signoffResolver = null;
        r();
      }
    }
  };

  const updateConfig = (patch: Partial<DebateConfig>): void => {
    dispatch({ type: 'updateConfig', patch });
    queueAppend({
      type: 'config_update',
      patch,
      timestamp: new Date().toISOString(),
    });
  };

  const userEdit = (newSpec: string): void => {
    if (state.phase !== 'debate') return;
    const wasAwaitingSignoff = state.awaitingSignoff;
    const ts = new Date().toISOString();
    dispatch({ type: 'userEdit', newSpec });
    queueAppend({
      type: 'user_edit',
      newSpec,
      timestamp: ts,
    });
    // If we were paused for signoff, the reducer cleared the flag — release
    // the runner so the agents react to the new spec.
    if (wasAwaitingSignoff && signoffResolver) {
      const r = signoffResolver;
      signoffResolver = null;
      r();
    }
  };

  const addContext = (content: string): void => {
    // Record as a userAnswer (the existing channel for "things the user said")
    // but never resolve a wait or abort a turn. The next agent prompt picks it
    // up via state.userAnswers like any other entry.
    const ts = new Date().toISOString();
    dispatch({ type: 'userAnswer', content, timestamp: ts });
    queueAppend({
      type: 'user_answer',
      content,
      timestamp: ts,
    });
  };

  const continueCollab = (): void => {
    if (collabPauseResolver) {
      const r = collabPauseResolver;
      collabPauseResolver = null;
      opts.onPauseChange?.(false);
      r();
    }
  };

  const done = (async () => {
    opts.onState?.(state);
    try {
      while (state.phase !== 'done' && !outer.signal.aborted) {
        // Resume case: if we boot into a rehydrated state that's already
        // mid-signoff, hold here for the user before scheduling another
        // agent turn. The mid-loop pause below covers the live path.
        if (state.awaitingSignoff && !outer.signal.aborted) {
          await new Promise<void>(resolve => {
            signoffResolver = resolve;
            outer.signal.addEventListener(
              'abort',
              () => {
                if (signoffResolver) {
                  signoffResolver = null;
                  resolve();
                }
              },
              { once: true },
            );
          });
          if ((state.phase as string) === 'done') break;
          if (outer.signal.aborted) break;
        }

        const speaker = nextSpeaker(state);
        dispatch({ type: 'turnStarted', speaker });

        turnController = new AbortController();
        outer.signal.addEventListener(
          'abort',
          () => turnController?.abort(),
          { once: true },
        );

        const ctx =
          state.phase === 'interview'
            ? { phase: 'interview' as const, prompt: interviewPrompt({ state, speaker }) }
            : { phase: 'debate' as const, prompt: debatePrompt({ state, speaker }) };

        let displayed = '';
        let rawTail: string | undefined;
        let usageTail: TurnUsage | undefined;
        const agent = opts.agents[speaker];
        if (!agent) {
          throw new Error(`startDebate: no agent registered for persona '${speaker}'`);
        }
        try {
          const iter = agent.stream(ctx, turnController.signal);
          while (true) {
            const r = await iter.next();
            if (r.done) {
              if (r.value) {
                rawTail = r.value.raw;
                usageTail = r.value.usage;
              }
              break;
            }
            displayed += r.value.text;
            opts.onToken?.(speaker, r.value.text);
          }
        } catch {
          /* aborts may throw — fine */
        }
        if (usageTail) opts.onUsage?.(speaker, usageTail);
        const raw = rawTail ?? displayed;
        const ts = new Date().toISOString();

        if (state.phase === 'interview') {
          const parsed = parseInterviewMessage(raw);
          const turnPayload = parsed.ok
            ? parsed.value
            : { commentary: raw, question: null, ready: false };
          dispatch({
            type: 'interviewTurn',
            timestamp: ts,
            turn: { speaker, ...turnPayload },
          });
          queueAppend({
            type: 'interview_turn',
            turn: { speaker, ...turnPayload, timestamp: ts },
          });
          // After phase transitions to debate, don't block for an answer.
          if (state.phase !== 'interview') continue;
          // Skip the wait ONLY if the agent explicitly signaled ready —
          // gating on `question === null` alone would also skip the wait
          // for malformed/empty responses (the parse-failure fallback uses
          // {question: null, ready: false}), which would let the interview
          // spin without ever collecting user input.
          if (turnPayload.ready) {
            pendingUserAnswer = null;
            continue;
          }

          // User typed while agent was streaming — their answer is already
          // recorded in state.userAnswers; skip the wait and let the next
          // agent see it via the interview prompt.
          if (pendingUserAnswer !== null) {
            pendingUserAnswer = null;
            continue;
          }

          // Wait for the user to answer (or /done) before the next turn.
          await new Promise<string | null>(resolve => {
            userAnswerResolver = resolve;
            outer.signal.addEventListener(
              'abort',
              () => {
                if (userAnswerResolver) {
                  userAnswerResolver = null;
                  resolve(null);
                }
              },
              { once: true },
            );
          });
          continue;
        }

        // debate phase
        const parsed = parseDebateMessage(raw);
        const turnPayload = parsed.ok
          ? parsed.value
          : { commentary: raw, edits: [], verdict: 'continue' as const };
        dispatch({
          type: 'debateTurn',
          speaker,
          commentary: turnPayload.commentary,
          edits: turnPayload.edits,
          verdict: turnPayload.verdict,
          timestamp: ts,
        });
        const debateTurn = state.debate[state.debate.length - 1];
        if (debateTurn) {
          queueAppend({
            type: 'debate_turn',
            turn: debateTurn,
          });
        }
        if ((state.phase as string) === 'done') break;

        // Mutual LGTM landed — pause for user signoff before finalizing.
        if (state.awaitingSignoff && !outer.signal.aborted) {
          await new Promise<void>(resolve => {
            signoffResolver = resolve;
            outer.signal.addEventListener(
              'abort',
              () => {
                if (signoffResolver) {
                  signoffResolver = null;
                  resolve();
                }
              },
              { once: true },
            );
          });
          if ((state.phase as string) === 'done') break;
          // Otherwise the user revised — fall through and keep debating.
        }

        if (mode === 'collab' && !outer.signal.aborted) {
          opts.onPauseChange?.(true);
          await new Promise<void>(resolve => {
            collabPauseResolver = resolve;
            outer.signal.addEventListener(
              'abort',
              () => {
                if (collabPauseResolver) {
                  collabPauseResolver = null;
                  resolve();
                }
              },
              { once: true },
            );
          });
          opts.onPauseChange?.(false);
        }
      }
      if (state.phase === 'done' && state.endReason) {
        queueAppend({
          type: 'done',
          reason: state.endReason,
          finalSpec: state.spec,
          timestamp: new Date().toISOString(),
        });
      }
    } finally {
      disposeAgents();
    }
    return state;
  })();

  return {
    done,
    interject,
    abort: () => outer.abort(),
    done_interview: doneInterview,
    updateConfig,
    userEdit,
    addContext,
    continue: continueCollab,
  };
}

export async function runDebate(opts: RunOptions): Promise<State> {
  return startDebate(opts).done;
}
