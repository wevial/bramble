import type { PersonaId } from '../personas/personas.js';
import type { State } from './state.js';

/**
 * Pick the next persona to speak in the current phase. Round-robins through
 * `state.activePersonas`, picking up from the persona after the last
 * speaker. The first turn of the session goes to the first persona in the
 * list (claude by default, but configurable).
 */
export function nextSpeaker(state: State): PersonaId {
  // activePersonas defaults to the legacy pair so old/manually-built states
  // (and rehydrated transcripts) still schedule correctly.
  const order = state.activePersonas ?? ['claude', 'codex'];
  if (order.length === 0) {
    throw new Error('nextSpeaker: state.activePersonas is empty');
  }
  const log = state.phase === 'interview' ? state.interview : state.debate;
  const last = log[log.length - 1];
  if (!last) return order[0]!;
  const idx = order.indexOf(last.speaker);
  if (idx === -1) {
    // Last speaker isn't in the active list (e.g. persona was removed
    // mid-session). Restart from the front.
    return order[0]!;
  }
  return order[(idx + 1) % order.length]!;
}
