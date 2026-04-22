import type { Speaker, State } from './types.js';

type AgentSpeaker = Extract<Speaker, 'claude' | 'codex'>;

export function nextSpeaker(state: State): AgentSpeaker {
  const lastAgentTurn = [...state.transcript]
    .reverse()
    .find(t => t.speaker === 'claude' || t.speaker === 'codex');

  if (!lastAgentTurn) return 'claude';
  return lastAgentTurn.speaker === 'claude' ? 'codex' : 'claude';
}
