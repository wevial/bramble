import { describe, it, expect } from 'vitest';
import type { State } from '../orchestrator/types.js';
import { buildExport } from './export.js';

function state(overrides: Partial<State>): State {
  return {
    transcript: [],
    currentDraft: null,
    accepted: false,
    speaker: 'idle',
    ...overrides,
  } as State;
}

describe('buildExport', () => {
  it('renders title + accepted spec + debate + metadata', () => {
    const out = buildExport({
      sessionName: 'purple-alpaca',
      goal: 'design auth',
      state: state({
        accepted: true,
        currentDraft: { proposer: 'claude', body: '# Auth\n\n- password' },
        transcript: [
          { speaker: 'claude', content: 'proposing v1', timestamp: '2026-04-23T00:00:01Z' },
          { speaker: 'codex', content: 'lgtm', timestamp: '2026-04-23T00:00:02Z' },
        ],
      }),
    });

    expect(out).toContain('# purple-alpaca');
    expect(out).toContain('**Goal:** design auth');
    expect(out).toContain('## Spec');
    expect(out).toContain('# Auth\n\n- password');
    expect(out).toContain('*Accepted — proposed by claude*');
    expect(out).toContain('## Debate transcript');
    expect(out).toContain('### claude');
    expect(out).toContain('proposing v1');
    expect(out).toContain('### codex');
    expect(out).toContain('lgtm');
  });

  it('notes when no spec was accepted', () => {
    const out = buildExport({
      sessionName: 'lonely',
      goal: 'x',
      state: state({}),
    });
    expect(out).toContain('*No spec accepted yet.*');
    expect(out).toContain('## Debate transcript');
  });
});
