import React from 'react';
import { describe, it, expect } from 'vitest';
import {
  StatusStrip,
  modelLabel,
  statusLabel,
  nextHint,
  lastSpeaker,
} from './StatusStrip.js';
import { initialState, type State } from '../orchestrator/state.js';
import type { ModelConfig } from './models.js';
import { renderFrame } from './test-renderer.js';

const T = '2026-04-28T00:00:00.000Z';

const models: ModelConfig = {
  claudeModel: 'claude-opus-4-7',
  claudeEffort: null,
  codexModel: 'gpt-5.4-mini',
  codexEffort: null,
};

function fresh(overrides: Partial<State> = {}): State {
  return { ...initialState('design x'), ...overrides };
}

describe('lastSpeaker', () => {
  it('returns null on a fresh state', () => {
    expect(lastSpeaker(fresh())).toBeNull();
  });

  it('returns the active speaker if claude or codex', () => {
    expect(lastSpeaker(fresh({ speaker: 'claude' }))).toBe('claude');
    expect(lastSpeaker(fresh({ speaker: 'codex' }))).toBe('codex');
  });

  it('falls back to the most recent log entry when idle', () => {
    const s = fresh({
      interview: [
        {
          speaker: 'claude',
          commentary: '',
          question: null,
          ready: false,
          timestamp: '2026-04-28T00:00:01.000Z',
        },
        {
          speaker: 'codex',
          commentary: '',
          question: null,
          ready: false,
          timestamp: '2026-04-28T00:00:02.000Z',
        },
      ],
    });
    expect(lastSpeaker(s)).toBe('codex');
  });
});

describe('modelLabel', () => {
  it('returns the speaker model when available', () => {
    expect(modelLabel(fresh({ speaker: 'claude' }), models)).toBe(
      'claude-opus-4-7',
    );
    expect(modelLabel(fresh({ speaker: 'codex' }), models)).toBe(
      'gpt-5.4-mini',
    );
  });

  it('returns em-dash before any speaker', () => {
    expect(modelLabel(fresh(), models)).toBe('—');
  });
});

describe('statusLabel / nextHint', () => {
  it('flags signoff', () => {
    const s = fresh({ phase: 'debate', awaitingSignoff: true });
    expect(statusLabel(s)).toMatch(/signoff/);
    expect(nextHint(s)).toMatch(/done/);
  });

  it('reports rounds and LGTM during debate', () => {
    const s = fresh({
      phase: 'debate',
      round: 2,
      lgtmThisRound: ['claude'],
    });
    expect(statusLabel(s)).toContain('round 2/8');
    expect(statusLabel(s)).toContain('1/2 LGTM');
  });

  it('flags ended sessions', () => {
    const s = fresh({ phase: 'done', endReason: 'mutual_lgtm' });
    expect(statusLabel(s)).toContain('mutual_lgtm');
    expect(nextHint(s)).toMatch(/ended/);
  });
});

describe('StatusStrip', () => {
  it('renders Model and Status and Next labels', async () => {
    const { frame, unmount } = await renderFrame(
      <StatusStrip state={fresh({ speaker: 'claude' })} models={models} />,
    );
    const out = frame;
    expect(out).toContain('Model:');
    expect(out).toContain('claude-opus-4-7');
    expect(out).toContain('Status:');
    expect(out).toContain('Next:');
    unmount();
  });
});

void T;
