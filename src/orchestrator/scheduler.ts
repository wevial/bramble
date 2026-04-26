import type { AgentName } from '../agents/agent.js';
import type { State } from './state.js';

/**
 * Pick the next agent to speak in the current phase.
 *
 * Both phases just alternate by the last speaker, claude first. Earlier
 * versions tried to "make the other agent react to the last editor" but
 * that locked into infinite loops if the responder didn't itself edit.
 * Plain alternation keeps round bookkeeping sane and termination
 * conditions reachable.
 */
export function nextSpeaker(state: State): AgentName {
  const log = state.phase === 'interview' ? state.interview : state.debate;
  const last = log[log.length - 1];
  if (!last) return 'claude';
  return other(last.speaker);
}

function other(a: AgentName): AgentName {
  return a === 'claude' ? 'codex' : 'claude';
}
