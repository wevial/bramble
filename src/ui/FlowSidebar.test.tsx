import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { FlowSidebar, flowStep } from './FlowSidebar.js';
import { initialState, type State } from '../orchestrator/state.js';

const T = '2026-04-28T00:00:00.000Z';

function fresh(overrides: Partial<State> = {}): State {
  return { ...initialState('design x'), ...overrides };
}

describe('flowStep', () => {
  it('Clarify (2) during interview', () => {
    expect(flowStep(fresh())).toBe(2);
  });

  it('Draft (3) during debate before any LGTM', () => {
    expect(flowStep(fresh({ phase: 'debate' }))).toBe(3);
  });

  it('Refine (4) once an LGTM has been seen this round', () => {
    expect(
      flowStep(fresh({ phase: 'debate', lgtmThisRound: ['claude'] })),
    ).toBe(4);
  });

  it('Refine (4) once an LGTM has been seen historically (across rounds)', () => {
    const s = fresh({
      phase: 'debate',
      debate: [
        {
          speaker: 'claude',
          commentary: '',
          edits: [],
          applied: [],
          rejected: [],
          verdict: 'lgtm',
          charsChanged: 0,
          round: 1,
          timestamp: T,
        },
      ],
      lgtmThisRound: [],
    });
    expect(flowStep(s)).toBe(4);
  });

  it('Export (5) when awaitingSignoff', () => {
    expect(
      flowStep(fresh({ phase: 'debate', awaitingSignoff: true })),
    ).toBe(5);
  });

  it('Export (5) when done', () => {
    expect(flowStep(fresh({ phase: 'done' }))).toBe(5);
  });
});

describe('FlowSidebar', () => {
  it('marks earlier steps done and current step in progress', () => {
    const { lastFrame } = render(
      <FlowSidebar state={fresh({ phase: 'debate' })} />,
    );
    const out = lastFrame() ?? '';
    // step 1 (Intent) and 2 (Clarify) are done; step 3 (Draft) is active
    expect(out).toMatch(/✓ 1\. Intent/);
    expect(out).toMatch(/✓ 2\. Clarify/);
    expect(out).toMatch(/◉ 3\. Draft/);
    expect(out).toContain('IN PROGRESS');
    expect(out).toMatch(/○ 4\. Refine/);
    expect(out).toMatch(/○ 5\. Export/);
  });

  it('shows Thinking next to the active speaker', () => {
    const { lastFrame } = render(
      <FlowSidebar
        state={fresh({ phase: 'debate', speaker: 'claude' })}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toMatch(/Claude.*Thinking/);
    // Codex line present but no Thinking
    expect(out).toMatch(/Codex/);
    expect(out.split('\n').find(l => l.includes('Codex'))).not.toMatch(
      /Thinking/,
    );
  });

  it('renders the user with the bramble sparkle', () => {
    const { lastFrame } = render(<FlowSidebar state={fresh()} />);
    expect(lastFrame() ?? '').toMatch(/✦.*You/);
  });
});
