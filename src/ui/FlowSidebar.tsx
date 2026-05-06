import { createTextAttributes } from '@opentui/core';
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
const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });

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
    <box flexDirection="column" paddingX={1}>
      <text><span fg="cyan" attributes={BOLD}>FLOW</span></text>
      <box height={1} />
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
          <box key={s.id} flexDirection="row">
            <box flexDirection="column" width={5} flexShrink={0}>
              <text>
                <span fg={markerColor} attributes={BOLD}>{marker}</span>
                <span> </span>
                <span fg={numColor} attributes={BOLD}>{s.id}</span>
                <span>  </span>
              </text>
              {Array.from({ length: gutterRows - 1 }, (_, r) => (
                <text key={r}>
                  {'  '}
                  {isLast ? (
                    <span> </span>
                  ) : (
                    <span fg={CONNECTOR_COLOR}>│</span>
                  )}
                  {'  '}
                </text>
              ))}
            </box>
            <box flexDirection="column" flexGrow={1}>
              <text>
                <span fg={labelColor} attributes={current ? BOLD : 0}>{s.label}</span>
              </text>
              {s.subtitle.map((line, j) => (
                <text key={j}><span attributes={DIM}>{line}</span></text>
              ))}
              <text>
                <span fg={tagColor} attributes={current ? BOLD : 0}>{tag}</span>
              </text>
              {!isLast ? <text> </text> : null}
            </box>
          </box>
        );
      })}
    </box>
  );
}

export function ParticipantsBox({ state }: { state: State }) {
  const speakingClaude = state.speaker === 'claude';
  const speakingCodex = state.speaker === 'codex';
  const claudeReady = state.readyAgents.includes('claude');
  const codexReady = state.readyAgents.includes('codex');
  return (
    <box flexDirection="column" paddingX={1}>
      <text><span fg="cyan" attributes={BOLD}>PARTICIPANTS</span></text>
      <box height={1} />
      <box flexDirection="row" justifyContent="space-between">
        <text>
          <span fg="brightGreen">✦ </span>
          <span fg="brightGreen" attributes={BOLD}>You</span>
        </text>
        <text><span fg="green">Active</span></text>
      </box>
      <box flexDirection="row" justifyContent="space-between">
        <text>
          <span fg="#FF8C42">☀ </span>
          <span fg="#FF8C42" attributes={BOLD}>Claude</span>
        </text>
        <text>
          <span fg={speakingClaude ? 'yellow' : claudeReady ? 'green' : 'gray'}>
            {speakingClaude ? 'Thinking…' : claudeReady ? 'Ready' : 'Idle'}
          </span>
        </text>
      </box>
      <box flexDirection="row" justifyContent="space-between">
        <text>
          <span fg="cyan">⊛ </span>
          <span fg="cyan" attributes={BOLD}>Codex</span>
        </text>
        <text>
          <span fg={speakingCodex ? 'yellow' : codexReady ? 'green' : 'gray'}>
            {speakingCodex ? 'Thinking…' : codexReady ? 'Ready' : 'Idle'}
          </span>
        </text>
      </box>
    </box>
  );
}

/** @deprecated use FlowBox + ParticipantsBox separately. */
export function FlowSidebar({ state }: { state: State }) {
  return (
    <box flexDirection="column">
      <FlowBox state={state} />
      <box height={1} />
      <ParticipantsBox state={state} />
    </box>
  );
}
