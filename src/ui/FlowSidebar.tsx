import React from 'react';
import { Box, Text } from 'ink';
import type { State } from '../orchestrator/state.js';

export type FlowStep = 1 | 2 | 3 | 4 | 5;

const STEPS: { id: FlowStep; label: string; subtitle: string }[] = [
  { id: 1, label: 'Intent', subtitle: 'Define what you want to build' },
  { id: 2, label: 'Clarify', subtitle: 'Claude and Codex sharpen the ask' },
  { id: 3, label: 'Draft', subtitle: 'Initial spec body comes together' },
  { id: 4, label: 'Refine', subtitle: 'You + agents iterate on the spec' },
  { id: 5, label: 'Export', subtitle: 'Sign off and copy spec.md' },
];

export function flowStep(state: State): FlowStep {
  if (state.phase === 'done') return 5;
  if (state.awaitingSignoff) return 5;
  if (state.phase === 'interview') return 2;
  // debate phase
  const anyLgtm =
    state.lgtmThisRound.length > 0 ||
    state.debate.some(t => t.verdict === 'lgtm');
  return anyLgtm ? 4 : 3;
}

export function FlowSidebar({ state }: { state: State }) {
  const active = flowStep(state);
  const speakingClaude = state.speaker === 'claude';
  const speakingCodex = state.speaker === 'codex';
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">FLOW</Text>
      <Box height={1} />
      {STEPS.map(s => {
        const done = s.id < active;
        const current = s.id === active;
        const marker = done ? '✓' : current ? '◉' : '○';
        const color = done ? 'green' : current ? 'yellow' : undefined;
        return (
          <Box key={s.id} flexDirection="column" marginBottom={1}>
            <Text>
              <Text color={color} bold={current}>
                {marker} {s.id}. {s.label}
              </Text>
              {current ? <Text color="yellow"> · IN PROGRESS</Text> : null}
            </Text>
            <Text dimColor>   {s.subtitle}</Text>
          </Box>
        );
      })}

      <Box height={1} />
      <Text bold color="cyan">PARTICIPANTS</Text>
      <Box height={1} />
      <Text>
        <Text color="greenBright">✦ </Text>
        <Text bold>You</Text>
      </Text>
      <Text>
        <Text color="cyan" bold>Claude</Text>
        {speakingClaude ? <Text color="yellow"> · Thinking…</Text> : null}
      </Text>
      <Text>
        <Text color="magenta" bold>Codex</Text>
        {speakingCodex ? <Text color="yellow"> · Thinking…</Text> : null}
      </Text>
    </Box>
  );
}
