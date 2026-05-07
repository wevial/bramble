import { describe, it, expect } from 'vitest';
import { nextSpeaker } from './scheduler.js';
import { initialState, reducer, type State } from './state.js';

const T = '2026-04-25T00:00:00.000Z';

describe('nextSpeaker — interview phase', () => {
  it('starts with claude on a fresh state', () => {
    expect(nextSpeaker(initialState('x'))).toBe('claude');
  });

  it('alternates after each interview turn', () => {
    let s = initialState('x');
    s = reducer(s, {
      type: 'interviewTurn',
      timestamp: T,
      turn: { speaker: 'claude', commentary: '', question: 'q', ready: false },
    });
    expect(nextSpeaker(s)).toBe('codex');
    s = reducer(s, {
      type: 'interviewTurn',
      timestamp: T,
      turn: { speaker: 'codex', commentary: '', question: 'q', ready: false },
    });
    expect(nextSpeaker(s)).toBe('claude');
  });
});

describe('nextSpeaker — multi-persona', () => {
  it('round-robins through three or more personas in order', () => {
    let s: State = {
      ...initialState('x', undefined, ['claude', 'codex', 'security']),
    };
    expect(nextSpeaker(s)).toBe('claude');
    s = reducer(s, {
      type: 'interviewTurn',
      timestamp: T,
      turn: { speaker: 'claude', commentary: '', question: 'q', ready: false },
    });
    expect(nextSpeaker(s)).toBe('codex');
    s = reducer(s, {
      type: 'interviewTurn',
      timestamp: T,
      turn: { speaker: 'codex', commentary: '', question: 'q', ready: false },
    });
    expect(nextSpeaker(s)).toBe('security');
    s = reducer(s, {
      type: 'interviewTurn',
      timestamp: T,
      turn: { speaker: 'security', commentary: '', question: 'q', ready: false },
    });
    // Wraps back to the first persona.
    expect(nextSpeaker(s)).toBe('claude');
  });

  it('phase only advances when EVERY persona signals ready', () => {
    let s: State = {
      ...initialState('x', undefined, ['claude', 'codex', 'security']),
    };
    for (const speaker of ['claude', 'codex'] as const) {
      s = reducer(s, {
        type: 'interviewTurn',
        timestamp: T,
        turn: { speaker, commentary: '', question: null, ready: true },
      });
    }
    // Two of three ready — still in interview.
    expect(s.phase).toBe('interview');
    s = reducer(s, {
      type: 'interviewTurn',
      timestamp: T,
      turn: { speaker: 'security', commentary: '', question: null, ready: true },
    });
    expect(s.phase).toBe('debate');
  });
});

describe('nextSpeaker — debate phase', () => {
  function debating(): State {
    return { ...initialState('x'), phase: 'debate' };
  }

  it('starts with claude when the debate is empty', () => {
    expect(nextSpeaker(debating())).toBe('claude');
  });

  it('alternates by last speaker regardless of who edited', () => {
    let s = debating();
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: '',
      edits: [{ find: '', replace: '# Spec' }],
      verdict: 'continue',
      timestamp: T,
    });
    expect(nextSpeaker(s)).toBe('codex');
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'codex',
      commentary: 'no edits this turn',
      edits: [],
      verdict: 'continue',
      timestamp: T,
    });
    // Codex just spoke (no edits) — claude goes next, NOT codex again. The
    // earlier "react to last editor" rule had this wrong and produced an
    // infinite loop when one agent stopped editing.
    expect(nextSpeaker(s)).toBe('claude');
  });
});
