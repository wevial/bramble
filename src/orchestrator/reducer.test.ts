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

  it('userInterjection appends a user turn to the transcript', () => {
    const next = reducer(initialState, {
      type: 'userInterjection',
      content: 'slow down',
      timestamp: 'tU',
    });
    expect(next.transcript).toEqual([
      { speaker: 'user', content: 'slow down', timestamp: 'tU' },
    ]);
    // does not change the speaker (user interjections don't "take the floor"
    // in the alternation sense; they just land in the transcript + get fed
    // into the next agent's context).
    expect(next.speaker).toBe('idle');
  });

  it('userInterjection preserves speaker when an agent is mid-turn', () => {
    const mid = reducer(initialState, { type: 'turnStarted', speaker: 'claude' });
    const next = reducer(mid, {
      type: 'userInterjection',
      content: 'hold on',
      timestamp: 'tU',
    });
    // user interjection does not flip speaker — the caller aborts the agent
    // separately. The reducer just records that the user said something.
    expect(next.speaker).toBe('claude');
    expect(next.transcript).toEqual([
      { speaker: 'user', content: 'hold on', timestamp: 'tU' },
    ]);
  });

  it('proposalReceived stores the draft body on state', () => {
    const next = reducer(initialState, {
      type: 'proposalReceived',
      speaker: 'claude',
      body: '# Auth\n\nemail+password',
    });
    expect(next.currentDraft).toEqual({
      body: '# Auth\n\nemail+password',
      proposer: 'claude',
    });
    expect(next.accepted).toBe(false);
  });

  it('proposalReceived replaces any prior draft', () => {
    let s = initialState;
    s = reducer(s, { type: 'proposalReceived', speaker: 'claude', body: 'v1' });
    s = reducer(s, { type: 'proposalReceived', speaker: 'codex', body: 'v2' });
    expect(s.currentDraft?.body).toBe('v2');
    expect(s.currentDraft?.proposer).toBe('codex');
  });

  it('verdictReceived: LGTM on an existing draft accepts it', () => {
    let s = initialState;
    s = reducer(s, { type: 'proposalReceived', speaker: 'claude', body: 'final' });
    s = reducer(s, { type: 'verdictReceived', speaker: 'codex', verdict: 'LGTM' });
    expect(s.accepted).toBe(true);
    expect(s.currentDraft?.body).toBe('final');
  });

  it('verdictReceived: LGTM with no draft does nothing', () => {
    const next = reducer(initialState, {
      type: 'verdictReceived',
      speaker: 'codex',
      verdict: 'LGTM',
    });
    expect(next.accepted).toBe(false);
    expect(next.currentDraft).toBeNull();
  });

  it('verdictReceived: self-LGTM on own proposal is ignored', () => {
    let s = initialState;
    s = reducer(s, { type: 'proposalReceived', speaker: 'claude', body: 'mine' });
    // Claude proposed, claude can't LGTM their own draft.
    s = reducer(s, { type: 'verdictReceived', speaker: 'claude', verdict: 'LGTM' });
    expect(s.accepted).toBe(false);
    // Codex LGTM after → accepted.
    s = reducer(s, { type: 'verdictReceived', speaker: 'codex', verdict: 'LGTM' });
    expect(s.accepted).toBe(true);
  });

  it('verdictReceived: counter clears no state (debate continues)', () => {
    let s = initialState;
    s = reducer(s, { type: 'proposalReceived', speaker: 'claude', body: 'x' });
    s = reducer(s, { type: 'verdictReceived', speaker: 'codex', verdict: 'counter' });
    expect(s.accepted).toBe(false);
    expect(s.currentDraft?.body).toBe('x');
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
