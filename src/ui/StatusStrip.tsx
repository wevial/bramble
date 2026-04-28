import React from 'react';
import { Box, Text } from 'ink';
import type { State } from '../orchestrator/state.js';
import type { ModelConfig } from './models.js';

export function lastSpeaker(state: State): 'claude' | 'codex' | null {
  if (state.speaker === 'claude' || state.speaker === 'codex') {
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
  if (who === 'claude') return models.claudeModel ?? 'claude (default)';
  if (who === 'codex') return models.codexModel ?? 'codex (default)';
  return '—';
}

export function statusLabel(state: State): string {
  if (state.endReason) return `done · ${state.endReason}`;
  if (state.awaitingSignoff) return 'awaiting your signoff';
  if (state.phase === 'interview') return 'clarifying requirements';
  if (state.phase === 'debate') {
    return `debate · round ${state.round || 1}/${state.config.maxRounds} · ${state.lgtmThisRound.length}/2 LGTM`;
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
    <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
      <Text>
        <Text dimColor>Status: </Text>
        <Text color="yellow">{statusLabel(state)}</Text>
      </Text>
      <Text>
        <Text dimColor>Model: </Text>
        <Text color="cyan">{modelLabel(state, models)}</Text>
      </Text>
      <Text>
        <Text dimColor>Next: </Text>
        <Text color="magenta">{nextHint(state)}</Text>
      </Text>
    </Box>
  );
}
