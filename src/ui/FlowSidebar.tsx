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

export function FlowBox({ state }: { state: State }) {
  const active = flowStep(state);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">FLOW</Text>
      <Box height={1} />
      {STEPS.map(s => {
        const done = s.id < active;
        const current = s.id === active;
        const marker = done ? '✓' : ' ';
        const numColor = done ? 'green' : current ? 'yellow' : 'white';
        const labelColor = done
          ? undefined
          : current
            ? 'yellow'
            : undefined;
        const tag = done
          ? 'COMPLETE'
          : current
            ? 'IN PROGRESS'
            : 'PENDING';
        const tagColor = done ? 'green' : current ? 'yellow' : 'gray';
        return (
          <Box key={s.id} flexDirection="column" marginBottom={1}>
            <Text>
              <Text color={numColor} bold>{marker} {s.id}.</Text>{' '}
              <Text color={labelColor} bold={current}>{s.label}</Text>
            </Text>
            <Text dimColor>   {s.subtitle}</Text>
            <Text>
              {'   '}
              <Text color={tagColor} bold={current}>{tag}</Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function ParticipantsBox({ state }: { state: State }) {
  const speakingClaude = state.speaker === 'claude';
  const speakingCodex = state.speaker === 'codex';
  const claudeReady = state.readyAgents.includes('claude');
  const codexReady = state.readyAgents.includes('codex');
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">PARTICIPANTS</Text>
      <Box height={1} />
      <Box justifyContent="space-between">
        <Text>
          <Text color="greenBright">✦ </Text>
          <Text bold>You</Text>
        </Text>
        <Text color="green">Active</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text color="cyan" bold>Claude</Text>
        <Text color={speakingClaude ? 'yellow' : claudeReady ? 'green' : 'gray'}>
          {speakingClaude ? 'Thinking…' : claudeReady ? 'Ready' : 'Idle'}
        </Text>
      </Box>
      <Box justifyContent="space-between">
        <Text color="magenta" bold>Codex</Text>
        <Text color={speakingCodex ? 'yellow' : codexReady ? 'green' : 'gray'}>
          {speakingCodex ? 'Thinking…' : codexReady ? 'Ready' : 'Idle'}
        </Text>
      </Box>
    </Box>
  );
}

/** @deprecated use FlowBox + ParticipantsBox separately. */
export function FlowSidebar({ state }: { state: State }) {
  return (
    <Box flexDirection="column">
      <FlowBox state={state} />
      <Box height={1} />
      <ParticipantsBox state={state} />
    </Box>
  );
}
