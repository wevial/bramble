import { createTextAttributes } from '@opentui/core';
import type { State } from '../orchestrator/state.js';
import type { PersonaId } from '../personas/personas.js';
import { findPersona } from '../personas/personas.js';
import type { ModelConfig } from './models.js';

const DIM = createTextAttributes({ dim: true });

export function lastSpeaker(state: State): PersonaId | null {
  if (state.speaker !== 'idle' && state.speaker !== 'user') {
    return state.speaker;
  }
  // Fall back to the most recent agent in any log.
  const all = [
    ...state.interview.map(t => ({ s: t.speaker, ts: t.timestamp })),
    ...state.debate.map(t => ({ s: t.speaker, ts: t.timestamp })),
  ];
  if (all.length === 0) return null;
  all.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  return all[0]!.s;
}

export function modelLabel(state: State, models: ModelConfig): string {
  const who = lastSpeaker(state);
  if (!who) return '—';
  const persona = findPersona(who);
  if (persona?.transport === 'claude') {
    return models.claudeModel ?? 'claude (default)';
  }
  if (persona?.transport === 'codex') {
    return models.codexModel ?? 'codex (default)';
  }
  return who;
}

export function statusLabel(state: State): string {
  if (state.endReason) return `done · ${state.endReason}`;
  if (state.awaitingSignoff) return 'awaiting your signoff';
  if (state.phase === 'interview') return 'clarifying requirements';
  if (state.phase === 'criteria') return 'locking success criteria';
  if (state.phase === 'debate') {
    const total = (state.activePersonas ?? ['claude', 'codex']).length;
    return `debate · round ${state.round || 1}/${state.config.maxRounds} · ${state.lgtmThisRound.length}/${total} LGTM`;
  }
  return state.phase;
}

export function nextHint(state: State): string {
  if (state.endReason) return 'session ended';
  if (state.awaitingSignoff) return 'type to revise · /done to finalize';
  if (state.phase === 'interview') {
    if (state.speaker === 'claude') return 'Claude is asking…';
    if (state.speaker === 'codex') return 'Codex is asking…';
    return 'awaiting next interview turn';
  }
  if (state.phase === 'criteria') {
    if (state.speaker === 'claude') return 'Claude is proposing criteria…';
    if (state.speaker === 'codex') return 'Codex is proposing criteria…';
    return 'type to revise · /done to lock criteria';
  }
  if (state.phase === 'debate') {
    if (state.speaker === 'claude') return 'Claude is drafting…';
    if (state.speaker === 'codex') return 'Codex is drafting…';
    return 'next agent will speak';
  }
  return '';
}

export function StatusStrip({
  state,
  models,
}: {
  state: State;
  models: ModelConfig;
}) {
  return (
    <box flexDirection="row" justifyContent="space-between" paddingX={1}>
      <text>
        <span attributes={DIM}>Status: </span>
        <span fg="yellow">{statusLabel(state)}</span>
      </text>
      <text>
        <span attributes={DIM}>Model: </span>
        <span fg="cyan">{modelLabel(state, models)}</span>
      </text>
      <text>
        <span attributes={DIM}>Next: </span>
        <span fg="magenta">{nextHint(state)}</span>
      </text>
    </box>
  );
}
