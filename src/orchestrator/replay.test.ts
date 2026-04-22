import { describe, it, expect } from 'vitest';
import { rehydrateState } from './replay.js';

describe('rehydrateState', () => {
  it('returns initial state for empty transcript', () => {
    const s = rehydrateState([]);
    expect(s.transcript).toEqual([]);
    expect(s.speaker).toBe('idle');
    expect(s.currentDraft).toBeNull();
    expect(s.accepted).toBe(false);
  });

  it('replays plain turns into a transcript of commentary', () => {
    const s = rehydrateState([
      { speaker: 'claude', content: 'hi', timestamp: 't1' },
      { speaker: 'codex', content: 'hello', timestamp: 't2' },
    ]);
    expect(s.transcript.map(t => t.speaker)).toEqual(['claude', 'codex']);
    expect(s.transcript.map(t => t.content)).toEqual(['hi', 'hello']);
  });

  it('recovers currentDraft from a proposal-bearing turn', () => {
    const raw = JSON.stringify({
      commentary: 'here is a draft',
      proposal: { body: '# Auth' },
      verdict: null,
    });
    const s = rehydrateState([
      { speaker: 'claude', content: raw, timestamp: 't1' },
    ]);
    expect(s.currentDraft?.body).toBe('# Auth');
    expect(s.currentDraft?.proposer).toBe('claude');
    expect(s.accepted).toBe(false);
  });

  it('recovers accepted=true after a cross-agent LGTM', () => {
    const proposal = JSON.stringify({
      commentary: 'draft',
      proposal: { body: '# Final' },
      verdict: null,
    });
    const lgtm = JSON.stringify({
      commentary: 'nice',
      proposal: null,
      verdict: 'LGTM',
    });
    const s = rehydrateState([
      { speaker: 'claude', content: proposal, timestamp: 't1' },
      { speaker: 'codex', content: lgtm, timestamp: 't2' },
    ]);
    expect(s.accepted).toBe(true);
    expect(s.currentDraft?.body).toBe('# Final');
  });

  it('drops self-LGTM during replay (same rule as reducer)', () => {
    const proposal = JSON.stringify({
      commentary: 'draft',
      proposal: { body: '# X' },
      verdict: null,
    });
    const selfLgtm = JSON.stringify({
      commentary: 'lgtm',
      proposal: null,
      verdict: 'LGTM',
    });
    const s = rehydrateState([
      { speaker: 'claude', content: proposal, timestamp: 't1' },
      { speaker: 'claude', content: selfLgtm, timestamp: 't2' },
    ]);
    expect(s.accepted).toBe(false);
  });
});
