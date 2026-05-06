import React from 'react';
import { Box, Text } from 'ink';
import type { State } from '../orchestrator/state.js';

export type FlowStep = 1 | 2 | 3 | 4 | 5;

const STEPS: { id: FlowStep; label: string; subtitle: string[] }[] = [
  {
    id: 1,
    label: 'Intent',
    subtitle: ['Define what you want'],
  },
  {
    id: 2,
    label: 'Clarify',
    subtitle: ['Claude and Codex ask', 'follow-up questions'],
  },
  {
    id: 3,
    label: 'Draft Spec',
    subtitle: ['Claude writes the', 'initial spec'],
  },
  {
    id: 4,
    label: 'Refine Spec',
    subtitle: ['You, Claude, and Codex', 'flesh out the spec'],
  },
  {
    id: 5,
    label: 'Export',
    subtitle: ['Save your .md file'],
  },
];

const ACTIVE_COLOR = '#7AA2FF'; // soft blue used for the current step
const DONE_COLOR = 'green';
const PENDING_COLOR = 'gray';
const CONNECTOR_COLOR = '#5B5F7A'; // muted purple-gray for the timeline rail

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
      {STEPS.map((s, i) => {
        const done = s.id < active;
        const current = s.id === active;
        const isLast = i === STEPS.length - 1;

        const marker = done ? '✓' : current ? '●' : ' ';
        const markerColor = done
          ? DONE_COLOR
          : current
            ? ACTIVE_COLOR
            : PENDING_COLOR;

        const numColor = done
          ? DONE_COLOR
          : current
            ? ACTIVE_COLOR
            : PENDING_COLOR;
        const labelColor = done
          ? undefined
          : current
            ? ACTIVE_COLOR
            : undefined;

        const tag = done
          ? 'COMPLETE'
          : current
            ? 'IN PROGRESS'
            : 'PENDING';
        const tagColor = done
          ? DONE_COLOR
          : current
            ? ACTIVE_COLOR
            : PENDING_COLOR;

        // Gutter is 5 columns wide:
        //   col 0: marker (✓ / ● / space)
        //   col 1: space
        //   col 2: step number on row 0; "│" connector on subsequent rows
        //   col 3-4: spaces
        // Connector rows extend through the inter-step gap so the rail
        // doesn't break between steps.
        const contentRows = 1 + s.subtitle.length + 1;
        const gutterRows = isLast ? contentRows : contentRows + 1;

        return (
          <Box key={s.id} flexDirection="row">
            <Box flexDirection="column" width={5} flexShrink={0}>
              <Text>
                <Text bold color={markerColor}>{marker}</Text>
                <Text> </Text>
                <Text color={numColor} bold>{s.id}</Text>
                <Text>  </Text>
              </Text>
              {Array.from({ length: gutterRows - 1 }, (_, r) => (
                <Text key={r}>
                  {'  '}
                  {isLast ? (
                    <Text> </Text>
                  ) : (
                    <Text color={CONNECTOR_COLOR}>│</Text>
                  )}
                  {'  '}
                </Text>
              ))}
            </Box>
            <Box flexDirection="column" flexGrow={1}>
              <Text color={labelColor} bold={current}>{s.label}</Text>
              {s.subtitle.map((line, j) => (
                <Text key={j} dimColor>{line}</Text>
              ))}
              <Text>
                <Text color={tagColor} bold={current}>{tag}</Text>
              </Text>
              {!isLast ? <Text> </Text> : null}
            </Box>
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
          <Text color="greenBright" bold>You</Text>
        </Text>
        <Text color="green">Active</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text>
          <Text color="#FF8C42">☀ </Text>
          <Text color="#FF8C42" bold>Claude</Text>
        </Text>
        <Text color={speakingClaude ? 'yellow' : claudeReady ? 'green' : 'gray'}>
          {speakingClaude ? 'Thinking…' : claudeReady ? 'Ready' : 'Idle'}
        </Text>
      </Box>
      <Box justifyContent="space-between">
        <Text>
          <Text color="cyan">⊛ </Text>
          <Text color="cyan" bold>Codex</Text>
        </Text>
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
