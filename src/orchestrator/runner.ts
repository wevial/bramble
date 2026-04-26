import type { Agent, AgentName, TurnUsage } from '../agents/agent.js';
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
  agents: { claude: Agent; codex: Agent };
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
  onToken?: (speaker: AgentName, text: string) => void;
  onState?: (state: State) => void;
  onUsage?: (speaker: AgentName, usage: TurnUsage) => void;
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
  /** In collab mode, advance past a between-turns pause. */
  continue(): void;
};

export function startDebate(opts: RunOptions): RunHandle {
  let state: State =
    opts.initialState ?? initialState(opts.prompt, opts.config);
  const mode: DebateMode = opts.mode ?? 'auto';
  const outer = new AbortController();
  opts.signal?.addEventListener('abort', () => outer.abort(), { once: true });

  let turnController: AbortController | null = null;
  let userAnswerResolver: ((content: string | null) => void) | null = null;
  let collabPauseResolver: (() => void) | null = null;

  let disposed = false;
  const disposeAgents = () => {
    if (disposed) return;
    disposed = true;
    try { opts.agents.claude.dispose?.(); } catch { /* ignore */ }
    try { opts.agents.codex.dispose?.(); } catch { /* ignore */ }
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
    // Debate: log the constraint and abort the active turn so the next agent
    // sees it. (Resolver-less interjection in interview phase falls here too,
    // so a user typing before the first turn finishes still records.)
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
  };

  const doneInterview = (): void => {
    if (state.phase !== 'interview') return;
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
  };

  const updateConfig = (patch: Partial<DebateConfig>): void => {
    dispatch({ type: 'updateConfig', patch });
    queueAppend({
      type: 'config_update',
      patch,
      timestamp: new Date().toISOString(),
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
        try {
          const iter = opts.agents[speaker].stream(ctx, turnController.signal);
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
    continue: continueCollab,
  };
}

export async function runDebate(opts: RunOptions): Promise<State> {
  return startDebate(opts).done;
}
