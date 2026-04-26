import type { AgentName } from '../agents/agent.js';
import type { Edit, RejectedEdit } from '../protocol/messages.js';
import { applyEdits } from '../protocol/messages.js';
import { checkTermination, type EndReason } from './termination.js';
export type { EndReason } from './termination.js';

export type Phase = 'interview' | 'debate' | 'done';

export type Speaker = AgentName | 'user';

export type InterviewTurn = {
  speaker: AgentName;
  commentary: string;
  question: string | null;
  ready: boolean;
  timestamp: string;
};

export type UserAnswer = {
  content: string;
  timestamp: string;
};

export type DebateTurn = {
  speaker: AgentName;
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
  /** Hard cap on rounds (one round = both agents speak). */
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
  /** Interview Q&A in chronological order. */
  interview: InterviewTurn[];
  /** User answers to interview questions, chronological. */
  userAnswers: UserAnswer[];
  /** Most recent ready vote per agent (set membership). */
  readyAgents: AgentName[];
  /** Debate turn log, chronological. */
  debate: DebateTurn[];
  /** Canonical spec.md body. */
  spec: string;
  /** Current debate round (1-indexed). 0 before any debate turn happens. */
  round: number;
  /** Per-round chars-changed totals (one entry per completed round). */
  roundVolumes: number[];
  /** LGTM votes received during the current open round. */
  lgtmThisRound: AgentName[];
  config: DebateConfig;
  endReason?: EndReason;
  /**
   * Set after both agents reach mutual LGTM in the same round, before the
   * runner finalizes the session. While true the loop pauses so the user
   * can either revise (any user input clears the flag and re-opens the
   * debate) or confirm via `/done` (which flips phase to 'done').
   */
  awaitingSignoff?: boolean;
};

export function initialState(
  prompt: string,
  config: Partial<DebateConfig> = {},
): State {
  return {
    phase: 'interview',
    speaker: 'idle',
    prompt,
    interview: [],
    userAnswers: [],
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
  | { type: 'turnStarted'; speaker: AgentName }
  | { type: 'interviewTurn'; turn: Omit<InterviewTurn, 'timestamp'>; timestamp: string }
  | { type: 'userAnswer'; content: string; timestamp: string }
  | { type: 'userDone' }
  | {
      type: 'debateTurn';
      speaker: AgentName;
      commentary: string;
      edits: Edit[];
      verdict: 'continue' | 'lgtm';
      timestamp: string;
    }
  | { type: 'userEdit'; newSpec: string }
  | { type: 'updateConfig'; patch: Partial<DebateConfig> };

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'turnStarted':
      return { ...state, speaker: action.speaker };

    case 'interviewTurn': {
      if (state.phase !== 'interview') return state;
      const turn: InterviewTurn = { ...action.turn, timestamp: action.timestamp };
      const interview = [...state.interview, turn];
      const readyAgents = setReady(state.readyAgents, turn.speaker, turn.ready);
      const bothReady =
        readyAgents.includes('claude') && readyAgents.includes('codex');
      return {
        ...state,
        speaker: 'idle',
        interview,
        readyAgents,
        phase: bothReady ? 'debate' : 'interview',
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
      if (state.phase === 'interview') {
        return { ...state, phase: 'debate' };
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

    case 'debateTurn': {
      if (state.phase !== 'debate') return state;
      // A round = one turn per agent. The Nth turn by this agent belongs to
      // round N. If both agents alternate normally (claude→codex→claude→codex)
      // the rounds are 1,1,2,2; if one agent speaks twice in a row they
      // advance to their next round independently.
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

      // Compute round-volume bookkeeping. A round is "complete" when both
      // agents have spoken in it; at that point we push the round's total
      // chars-changed into roundVolumes and clear lgtmThisRound (mutual LGTM
      // is already detected before clearing — see below).
      const debate = [...state.debate, turn];
      const turnsInRound = countTurnsInRound(debate, round);

      let next: State = {
        ...state,
        speaker: 'idle',
        debate,
        spec: newSpec,
        round,
        lgtmThisRound,
      };

      if (turnsInRound === 2) {
        // Round closed — sum its chars-changed.
        const volume = debate
          .filter(t => t.round === round)
          .reduce((sum, t) => sum + t.charsChanged, 0);
        const roundVolumes = [...state.roundVolumes, volume];
        // Termination check uses the just-closed round's tallies.
        const reason = checkTermination({
          round,
          maxRounds: state.config.maxRounds,
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
      return { ...state, spec: action.newSpec, roundVolumes: [] };
    }

    case 'updateConfig':
      return { ...state, config: { ...state.config, ...action.patch } };
  }
}

function setReady(
  current: AgentName[],
  speaker: AgentName,
  ready: boolean,
): AgentName[] {
  const has = current.includes(speaker);
  if (ready && !has) return [...current, speaker];
  if (!ready && has) return current.filter(a => a !== speaker);
  return current;
}

function countTurnsInRound(debate: DebateTurn[], round: number): number {
  let n = 0;
  for (const t of debate) if (t.round === round) n++;
  return n;
}
