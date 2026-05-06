import React from 'react';
import { describe, it, expect } from 'vitest';
import { FlowSidebar, flowStep } from './FlowSidebar.js';
import { initialState, type State } from '../orchestrator/state.js';
import { renderFrame } from './test-renderer.js';

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
  it('marks earlier steps done and current step in progress', async () => {
    const { frame, unmount } = await renderFrame(
      <FlowSidebar state={fresh({ phase: 'debate' })} />,
    );
    const out = frame;
    // step 1 (Intent) and 2 (Clarify) are done; step 3 (Draft Spec) is active
    expect(out).toContain('Intent');
    expect(out).toContain('Clarify');
    expect(out).toContain('Draft Spec');
    expect(out).toContain('Refine Spec');
    expect(out).toContain('Export');
    // current step uses the filled-circle marker
    expect(out).toContain('●');
    // done steps use the check marker
    expect(out).toContain('✓');
    expect(out).toContain('IN PROGRESS');
    expect(out).toContain('PENDING');
    expect(out).toContain('COMPLETE');
    unmount();
  });

  it('shows Thinking next to the active speaker', async () => {
    const { frame, unmount } = await renderFrame(
      <FlowSidebar
        state={fresh({ phase: 'debate', speaker: 'claude' })}
      />,
    );
    const out = frame;
    expect(out).toContain('Claude');
    expect(out).toContain('Thinking');
    // Codex line present but no Thinking
    expect(out).toMatch(/Codex/);
    expect(out.split('\n').find(l => l.includes('Codex'))).not.toMatch(
      /Thinking/,
    );
    unmount();
  });

  it('renders the user with the bramble sparkle', async () => {
    const { frame, unmount } = await renderFrame(<FlowSidebar state={fresh()} />);
    expect(frame).toMatch(/✦.*You/);
    unmount();
  });
});
