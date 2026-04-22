import { parseAgentOutput } from '../protocol/patch.js';
import { reducer } from './reducer.js';
import { initialState, type State, type TurnRecord } from './types.js';

/**
 * Rebuild a State by replaying the reducer over a transcript. Used for
 * --resume: reads transcript-<name>.jsonl, rebuilds state, then continues
 * the debate from the next speaker's turn.
 *
 * Replays the same action sequence the live runner would have dispatched:
 *   turnCompleted  → always
 *   proposalReceived / verdictReceived → when the content parses as our
 *     AgentOutput wire format (plain-text turns just become commentary).
 */
export function rehydrateState(turns: TurnRecord[]): State {
  let state: State = { ...initialState };
  for (const t of turns) {
    state = reducer(state, {
      type: 'turnCompleted',
      speaker: t.speaker,
      content: t.content,
      timestamp: t.timestamp,
    });
    if (t.speaker !== 'claude' && t.speaker !== 'codex') continue;
    const parsed = parseAgentOutput(t.content, { fallbackToCommentary: true });
    if (!parsed.ok) continue;
    if (parsed.value.proposal) {
      state = reducer(state, {
        type: 'proposalReceived',
        speaker: t.speaker,
        body: parsed.value.proposal.body,
      });
    }
    if (parsed.value.verdict) {
      state = reducer(state, {
        type: 'verdictReceived',
        speaker: t.speaker,
        verdict: parsed.value.verdict,
      });
    }
  }
  return state;
}
