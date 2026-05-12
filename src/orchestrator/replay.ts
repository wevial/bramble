import { initialState, reducer, type State } from './state.js';
import type { TranscriptEntry } from '../docs/transcript.js';

/**
 * Rebuild State by feeding a transcript through the reducer. The first entry
 * MUST be of type 'session' — it carries the prompt + initial config.
 *
 * Returns null if the transcript is empty or malformed (no session entry).
 */
export function rehydrateState(entries: TranscriptEntry[]): State | null {
  const first = entries[0];
  if (!first || first.type !== 'session') return null;

  let state = initialState(first.prompt, first.config);
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i]!;
    state = applyEntry(state, e);
  }
  return state;
}

function applyEntry(state: State, e: TranscriptEntry): State {
  switch (e.type) {
    case 'session':
      // Should only appear at index 0; ignore duplicates.
      return state;
    case 'interview_turn':
      return reducer(state, {
        type: 'interviewTurn',
        timestamp: e.turn.timestamp,
        turn: {
          speaker: e.turn.speaker,
          commentary: e.turn.commentary,
          question: e.turn.question,
          ready: e.turn.ready,
        },
      });
    case 'criteria_turn':
      return reducer(state, {
        type: 'criteriaTurn',
        timestamp: e.turn.timestamp,
        turn: {
          speaker: e.turn.speaker,
          commentary: e.turn.commentary,
          proposed: e.turn.proposed,
        },
      });
    case 'user_answer':
      return reducer(state, {
        type: 'userAnswer',
        content: e.content,
        timestamp: e.timestamp,
      });
    case 'user_done':
      return reducer(state, { type: 'userDone' });
    case 'debate_turn':
      return reducer(state, {
        type: 'debateTurn',
        speaker: e.turn.speaker,
        commentary: e.turn.commentary,
        edits: e.turn.edits,
        verdict: e.turn.verdict,
        timestamp: e.turn.timestamp,
      });
    case 'user_edit':
      return reducer(state, { type: 'userEdit', newSpec: e.newSpec });
    case 'config_update':
      return reducer(state, { type: 'updateConfig', patch: e.patch });
    case 'phase_change':
    case 'done':
      // Informational — current state already reflects these.
      return state;
  }
}

