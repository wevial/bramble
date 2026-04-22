import { describe, it, expect } from 'vitest';
import { reducer } from './reducer.js';
import { initialState } from './types.js';

describe('reducer', () => {
  it('starts idle with empty transcript', () => {
    expect(initialState.speaker).toBe('idle');
    expect(initialState.transcript).toEqual([]);
  });

  it('turnStarted sets the current speaker', () => {
    const next = reducer(initialState, { type: 'turnStarted', speaker: 'claude' });
    expect(next.speaker).toBe('claude');
    expect(next.transcript).toEqual([]);
  });

  it('turnCompleted appends a transcript entry and returns to idle', () => {
    const mid = reducer(initialState, { type: 'turnStarted', speaker: 'claude' });
    const next = reducer(mid, {
      type: 'turnCompleted',
      speaker: 'claude',
      content: 'hello',
      timestamp: '2026-04-22T00:00:00.000Z',
    });
    expect(next.speaker).toBe('idle');
    expect(next.transcript).toEqual([
      { speaker: 'claude', content: 'hello', timestamp: '2026-04-22T00:00:00.000Z' },
    ]);
  });

  it('preserves order across multiple completed turns', () => {
    let s = initialState;
    s = reducer(s, { type: 'turnCompleted', speaker: 'claude', content: 'a', timestamp: 't1' });
    s = reducer(s, { type: 'turnCompleted', speaker: 'codex', content: 'b', timestamp: 't2' });
    s = reducer(s, { type: 'turnCompleted', speaker: 'claude', content: 'c', timestamp: 't3' });
    expect(s.transcript.map(t => t.content)).toEqual(['a', 'b', 'c']);
    expect(s.transcript.map(t => t.speaker)).toEqual(['claude', 'codex', 'claude']);
  });

  it('is a pure function (does not mutate prior state)', () => {
    const before = { ...initialState, transcript: [] as any[] };
    const after = reducer(before, {
      type: 'turnCompleted',
      speaker: 'codex',
      content: 'x',
      timestamp: 't',
    });
    expect(before.transcript).toEqual([]);
    expect(after.transcript).toHaveLength(1);
    expect(after).not.toBe(before);
  });
});
