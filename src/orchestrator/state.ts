import type { Edit, RejectedEdit } from '../protocol/messages.js';
import { applyEdits } from '../protocol/messages.js';
import type { PersonaId } from '../personas/personas.js';
import { findPersona } from '../personas/personas.js';
import { checkTermination, type EndReason } from './termination.js';
export type { EndReason } from './termination.js';

export type Phase = 'interview' | 'criteria' | 'debate' | 'done';

export type Speaker = PersonaId | 'user';

export type InterviewTurn = {
  speaker: PersonaId;
  commentary: string;
  question: string | null;
  ready: boolean;
  timestamp: string;
};

export type UserAnswer = {
  content: string;
  timestamp: string;
};

export type CriteriaTurn = {
  speaker: PersonaId;
  /** Free-form notes / rationale shown in the conversation feed. */
  commentary: string;
  /**
   * The agent's proposed success-criteria list at this turn. Each item is
   * a single measurable signal (e.g. "Command exits 0 on a valid coin flip").
   * Order is the agent's choice; the user owns final approval.
   */
  proposed: string[];
  timestamp: string;
};

export type DebateTurn = {
  speaker: PersonaId;
  commentary: string;
  /** Original edit list as the agent submitted it, in submission order. */
  edits: Edit[];
  /** Edits that successfully applied to the spec on this turn. */
  applied: Edit[];
  /** Edits the agent emitted that did not apply (fed back next turn). */
  rejected: RejectedEdit[];
  verdict: 'continue' | 'lgtm';
  charsChanged: number;
  /** Round number this turn belongs to (1-indexed). */
  round: number;
  timestamp: string;
};

export type DebateConfig = {
  /** Hard cap on rounds (one round = every persona speaks once). */
  maxRounds: number;
  /** Per-round chars-changed threshold for the decay convergence signal. */
  decayThreshold: number;
  /** Number of consecutive sub-threshold rounds required to trigger decay. */
  decayWindow: number;
};

export const DEFAULT_DEBATE_CONFIG: DebateConfig = {
  maxRounds: 8,
  decayThreshold: 50,
  decayWindow: 2,
};

export type State = {
  phase: Phase;
  speaker: Speaker | 'idle';
  /** The user's original goal prompt. */
  prompt: string;
  /**
   * Personas active in this session, in scheduling order. The scheduler
   * round-robins through this list; termination requires every persona to
   * LGTM in the same round. Defaults to `['claude', 'codex']` for legacy
   * sessions / replays.
   */
  activePersonas: PersonaId[];
  /** Interview Q&A in chronological order. */
  interview: InterviewTurn[];
  /** User answers to interview questions, chronological. */
  userAnswers: UserAnswer[];
  /**
   * Per-turn proposals during the success-criteria phase. Empty until the
   * interview ends; frozen once phase transitions to debate. The user's
   * approved final list lives in `criteria` (below).
   */
  criteriaTurns: CriteriaTurn[];
  /**
   * The user-approved success-criteria list. Set when phase advances from
   * 'criteria' to 'debate'. Injected into the debate prompt so agents
   * draft against measurable signals instead of vibes. Empty if the user
   * skipped the criteria step (toggled off in setup).
   */
  criteria: string[];
  /**
   * Whether the success-criteria step is enabled for this session. When
   * true, the interview→debate transition routes through a dedicated
   * 'criteria' phase. When false, interview goes straight to debate
   * (preserves backward-compat for older transcripts and any test that
   * doesn't opt in). Set at session start; not changed afterwards.
   */
  criteriaStepEnabled?: boolean;
  /** Most recent ready vote per persona (set membership). */
  readyAgents: PersonaId[];
  /** Debate turn log, chronological. */
  debate: DebateTurn[];
  /** Canonical spec.md body. */
  spec: string;
  /** Current debate round (1-indexed). 0 before any debate turn happens. */
  round: number;
  /** Per-round chars-changed totals (one entry per completed round). */
  roundVolumes: number[];
  /** LGTM votes received during the current open round. */
  lgtmThisRound: PersonaId[];
  config: DebateConfig;
  endReason?: EndReason;
  /**
   * Set after every persona reaches mutual LGTM in the same round, before
   * the runner finalizes the session. While true the loop pauses so the
   * user can either revise (any user input clears the flag and re-opens
   * the debate) or confirm via `/done` (which flips phase to 'done').
   */
  awaitingSignoff?: boolean;
  /**
   * Last reason emitted by the moderator (if any) explaining why the next
   * speaker was chosen. Rendered in the conversation pane as attribution
   * under the next speaker's header. Null when round-robin scheduling is
   * in use or no pick has been made yet.
   */
  lastModeratorReason?: string | null;
};

export function initialState(
  prompt: string,
  config: Partial<DebateConfig> = {},
  activePersonas: PersonaId[] = ['claude', 'codex'],
): State {
  return {
    phase: 'interview',
    speaker: 'idle',
    prompt,
    activePersonas,
    interview: [],
    userAnswers: [],
    criteriaTurns: [],
    criteria: [],
    readyAgents: [],
    debate: [],
    spec: '',
    round: 0,
    roundVolumes: [],
    lgtmThisRound: [],
    config: { ...DEFAULT_DEBATE_CONFIG, ...config },
  };
}

export type Action =
  | { type: 'turnStarted'; speaker: PersonaId }
  | { type: 'interviewTurn'; turn: Omit<InterviewTurn, 'timestamp'>; timestamp: string }
  | { type: 'userAnswer'; content: string; timestamp: string }
  | { type: 'userDone' }
  | { type: 'criteriaTurn'; turn: Omit<CriteriaTurn, 'timestamp'>; timestamp: string }
  | { type: 'criteriaApproved'; criteria: string[] }
  | {
      type: 'debateTurn';
      speaker: PersonaId;
      commentary: string;
      edits: Edit[];
      verdict: 'continue' | 'lgtm';
      timestamp: string;
    }
  | { type: 'userEdit'; newSpec: string }
  | { type: 'updateConfig'; patch: Partial<DebateConfig> }
  | { type: 'moderatorPicked'; speaker: PersonaId; reason: string };

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'turnStarted':
      return { ...state, speaker: action.speaker };

    case 'interviewTurn': {
      if (state.phase !== 'interview') return state;
      const turn: InterviewTurn = { ...action.turn, timestamp: action.timestamp };
      const interview = [...state.interview, turn];
      const readyAgents = setReady(state.readyAgents, turn.speaker, turn.ready);
      const active = state.activePersonas ?? ['claude', 'codex'];
      // Phase advance gates on PRIMARIES only. Specialists are advisory —
      // they may speak or stay silent in interview, but they don't block the
      // transition out of interview.
      const primaries = primariesOf(active);
      const allReady = primaries.every(p => readyAgents.includes(p));
      return {
        ...state,
        speaker: 'idle',
        interview,
        readyAgents,
        // Sessions that enabled the success-criteria step route through the
        // 'criteria' phase first. Sessions without it (off-by-default for
        // legacy callers / tests) go straight to debate as before.
        phase: allReady
          ? state.criteriaStepEnabled
            ? 'criteria'
            : 'debate'
          : 'interview',
      };
    }

    case 'userAnswer': {
      const userAnswers = [
        ...state.userAnswers,
        { content: action.content, timestamp: action.timestamp },
      ];
      // A user message during the post-LGTM signoff pause is implicitly a
      // revision request: clear awaitingSignoff and the round's LGTM votes
      // so the debate re-opens for another round.
      if (state.awaitingSignoff) {
        return {
          ...state,
          userAnswers,
          awaitingSignoff: false,
          lgtmThisRound: [],
        };
      }
      return { ...state, userAnswers };
    }

    case 'userDone':
      // /done from interview jumps straight past criteria into debate
      // (treated as "skip the rest of clarification AND the criteria step").
      if (state.phase === 'interview') {
        return { ...state, phase: 'debate' };
      }
      // /done from criteria locks in whatever the latest agent proposed
      // (or an empty list if nothing has been proposed yet) and advances
      // to debate.
      if (state.phase === 'criteria') {
        const last = state.criteriaTurns[state.criteriaTurns.length - 1];
        return {
          ...state,
          phase: 'debate',
          criteria: last?.proposed ?? [],
        };
      }
      if (state.awaitingSignoff) {
        return {
          ...state,
          phase: 'done',
          endReason: 'mutual_lgtm',
          awaitingSignoff: false,
        };
      }
      return state;

    case 'criteriaTurn': {
      if (state.phase !== 'criteria') return state;
      const turn: CriteriaTurn = { ...action.turn, timestamp: action.timestamp };
      return {
        ...state,
        speaker: 'idle',
        criteriaTurns: [...state.criteriaTurns, turn],
      };
    }

    case 'criteriaApproved': {
      // Explicit user approval of the current criteria list — advances to
      // debate with the approved list locked into state.criteria so the
      // debate prompt can reference it.
      if (state.phase !== 'criteria') return state;
      return {
        ...state,
        phase: 'debate',
        criteria: action.criteria,
      };
    }

    case 'debateTurn': {
      if (state.phase !== 'debate') return state;
      // A round = one turn per active persona. The Nth turn by this persona
      // belongs to round N. Personas may advance independently if the
      // schedule glitches and one speaks twice in a row.
      const priorTurnsByThisAgent = state.debate.filter(
        t => t.speaker === action.speaker,
      ).length;
      const round = priorTurnsByThisAgent + 1;

      const { newSpec, applied, rejected, charsChanged } = applyEdits(
        state.spec,
        action.edits,
      );
      const turn: DebateTurn = {
        speaker: action.speaker,
        commentary: action.commentary,
        edits: action.edits,
        applied,
        rejected,
        verdict: action.verdict,
        charsChanged,
        round,
        timestamp: action.timestamp,
      };

      // Track LGTMs seen during the currently-open round.
      let lgtmThisRound = state.lgtmThisRound;
      if (action.verdict === 'lgtm') {
        if (!lgtmThisRound.includes(action.speaker)) {
          lgtmThisRound = [...lgtmThisRound, action.speaker];
        }
      }

      // Compute round-volume bookkeeping. A round is "complete" when every
      // primary persona has spoken in it. Specialists may chime in or skip
      // any round — they're advisory and shouldn't drive the round boundary.
      const debate = [...state.debate, turn];
      const activeForDebate = state.activePersonas ?? ['claude', 'codex'];
      const primariesForDebate = primariesOf(activeForDebate);
      const primarySpeakersInRound = new Set(
        debate
          .filter(t => t.round === round && primariesForDebate.includes(t.speaker))
          .map(t => t.speaker),
      );
      const roundClosed =
        primariesForDebate.length > 0 &&
        primariesForDebate.every(p => primarySpeakersInRound.has(p));

      let next: State = {
        ...state,
        speaker: 'idle',
        debate,
        spec: newSpec,
        round,
        lgtmThisRound,
      };

      if (roundClosed) {
        // Round closed — sum its chars-changed.
        const volume = debate
          .filter(t => t.round === round)
          .reduce((sum, t) => sum + t.charsChanged, 0);
        const roundVolumes = [...state.roundVolumes, volume];
        // Termination check is keyed on primaries (specialists don't gate
        // mutual_lgtm) so consensus depends only on the spec authors.
        const reason = checkTermination({
          round,
          maxRounds: state.config.maxRounds,
          activePersonas: primariesForDebate,
          lgtmThisRound,
          roundVolumes,
          decayThreshold: state.config.decayThreshold,
          decayWindow: state.config.decayWindow,
        });
        next = {
          ...next,
          roundVolumes,
          // Reset LGTM accumulator at the round boundary so the next round
          // starts fresh — agents can change their minds.
          lgtmThisRound: [],
        };
        if (reason === 'mutual_lgtm') {
          // Hold short of 'done' so the user can sign off (or push back).
          next = { ...next, awaitingSignoff: true };
        } else if (reason !== null) {
          next = { ...next, phase: 'done', endReason: reason };
        }
      }
      return next;
    }

    case 'userEdit': {
      if (state.phase !== 'debate') return state;
      // Manual user edit resets the decay signal — the spec just changed, so
      // the next agent turns shouldn't be counted as "stable" off old volumes.
      // Also re-opens the debate if we were paused for signoff: the user just
      // changed the deliverable, so prior LGTMs no longer apply.
      return {
        ...state,
        spec: action.newSpec,
        roundVolumes: [],
        awaitingSignoff: false,
        lgtmThisRound: state.awaitingSignoff ? [] : state.lgtmThisRound,
      };
    }

    case 'updateConfig':
      return { ...state, config: { ...state.config, ...action.patch } };

    case 'moderatorPicked':
      return { ...state, lastModeratorReason: action.reason || null };
  }
}

function setReady(
  current: PersonaId[],
  speaker: PersonaId,
  ready: boolean,
): PersonaId[] {
  const has = current.includes(speaker);
  if (ready && !has) return [...current, speaker];
  if (!ready && has) return current.filter(a => a !== speaker);
  return current;
}

function primariesOf(ids: PersonaId[]): PersonaId[] {
  return ids.filter(id => {
    const p = findPersona(id);
    // Unknown personas (custom IDs we can't look up) are treated as primary
    // so we don't silently drop them from the gate.
    return !p || p.scope === 'primary';
  });
}

