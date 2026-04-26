import type { AgentName } from '../agents/agent.js';
import type { State } from './state.js';

/**
 * Pick the next agent to speak in the current phase.
 *
 * Interview: alternate, claude first.
 *
 * Debate: alternate, but the agent who proposed the most-recent landed edit
 * gets reacted to first (so the OTHER agent gets the next turn). Falls back
 * to alternation by last speaker, or claude if the debate hasn't started.
 */
export function nextSpeaker(state: State): AgentName {
  if (state.phase === 'interview') {
    const last = state.interview[state.interview.length - 1];
    if (!last) return 'claude';
    return other(last.speaker);
  }
  // debate
  const lastEditor = [...state.debate]
    .reverse()
    .find(t => t.applied.length > 0);
  if (lastEditor) return other(lastEditor.speaker);
  const lastSpeaker = state.debate[state.debate.length - 1];
  if (!lastSpeaker) return 'claude';
  return other(lastSpeaker.speaker);
}

function other(a: AgentName): AgentName {
  return a === 'claude' ? 'codex' : 'claude';
}
