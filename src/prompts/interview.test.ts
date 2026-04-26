import { describe, it, expect } from 'vitest';
import { initialState, reducer, type State } from '../orchestrator/state.js';
import { interviewPrompt } from './interview.js';

const T1 = '2026-04-25T00:00:00.000Z';
const T2 = '2026-04-25T00:01:00.000Z';
const T3 = '2026-04-25T00:02:00.000Z';
const T4 = '2026-04-25T00:03:00.000Z';

function asInterview(s: State): State {
  // initialState already starts in interview phase; helper kept for clarity.
  return s;
}

describe('interviewPrompt', () => {
  it('renders the goal on a fresh state', () => {
    const out = interviewPrompt({
      state: asInterview(initialState('design a tic-tac-toe CLI')),
      speaker: 'claude',
    });
    expect(out).toContain('# Goal');
    expect(out).toContain('design a tic-tac-toe CLI');
    expect(out).toContain('# Your turn');
  });

  it('does not include an interview-so-far section before the first turn', () => {
    const out = interviewPrompt({
      state: initialState('x'),
      speaker: 'claude',
    });
    expect(out).not.toContain('# Interview so far');
  });

  it('renders prior Q&A interleaved with user answers', () => {
    let s = initialState('design x');
    s = reducer(s, {
      type: 'interviewTurn',
      timestamp: T1,
      turn: { speaker: 'claude', commentary: 'scoping users', question: 'who are the users?', ready: false },
    });
    s = reducer(s, {
      type: 'userAnswer',
      content: 'internal employees only',
      timestamp: T2,
    });
    s = reducer(s, {
      type: 'interviewTurn',
      timestamp: T3,
      turn: { speaker: 'codex', commentary: 'now compliance', question: 'any compliance scope?', ready: false },
    });
    s = reducer(s, {
      type: 'userAnswer',
      content: 'SOC 2',
      timestamp: T4,
    });
    const out = interviewPrompt({ state: s, speaker: 'claude' });
    // Each prior turn should be visible
    expect(out).toContain('who are the users?');
    expect(out).toContain('internal employees only');
    expect(out).toContain('any compliance scope?');
    expect(out).toContain('SOC 2');
  });

  it('marks the speaker\'s own turns with "(you)"', () => {
    let s = initialState('design x');
    s = reducer(s, {
      type: 'interviewTurn',
      timestamp: T1,
      turn: { speaker: 'claude', commentary: '', question: 'q1', ready: false },
    });
    const fromClaude = interviewPrompt({ state: s, speaker: 'claude' });
    const fromCodex = interviewPrompt({ state: s, speaker: 'codex' });
    expect(fromClaude).toContain('claude (you)');
    expect(fromCodex).toContain('claude');
    expect(fromCodex).not.toContain('claude (you)');
  });

  it('hints that the OTHER agent has signaled ready when applicable', () => {
    let s = initialState('x');
    s = reducer(s, {
      type: 'interviewTurn',
      timestamp: T1,
      turn: { speaker: 'codex', commentary: '', question: null, ready: true },
    });
    const out = interviewPrompt({ state: s, speaker: 'claude' });
    expect(out).toContain('codex has signaled ready');
  });
});
