import { describe, it, expect } from 'vitest';
import { initialState, reducer, type State } from '../orchestrator/state.js';
import { debatePrompt } from './debate.js';

const T1 = '2026-04-25T00:00:00.000Z';
const T2 = '2026-04-25T00:01:00.000Z';
const T3 = '2026-04-25T00:02:00.000Z';
const T4 = '2026-04-25T00:03:00.000Z';

function debating(prompt = 'design x'): State {
  return { ...initialState(prompt), phase: 'debate' };
}

describe('debatePrompt', () => {
  it('renders the goal and an empty-spec hint when no edits have landed', () => {
    const out = debatePrompt({ state: debating(), speaker: 'claude' });
    expect(out).toContain('# Goal');
    expect(out).toContain('# Current spec.md');
    expect(out).toContain('(empty');
  });

  it('renders the current spec body when present', () => {
    let s = debating();
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: 'seeding',
      edits: [{ find: '', replace: '# Spec\n\n## Goals\nDraft.' }],
      verdict: 'continue',
      timestamp: T1,
    });
    const out = debatePrompt({ state: s, speaker: 'codex' });
    expect(out).toContain('## Goals');
    expect(out).toContain('Draft.');
  });

  it('pins the interview transcript so it stays cacheable across debate turns', () => {
    let s = initialState('x');
    s = reducer(s, {
      type: 'interviewTurn',
      timestamp: T1,
      turn: { speaker: 'claude', commentary: '', question: 'who?', ready: false },
    });
    s = reducer(s, {
      type: 'userAnswer',
      content: 'internal only',
      timestamp: T2,
    });
    s = reducer(s, { type: 'userDone' });
    const out = debatePrompt({ state: s, speaker: 'claude' });
    expect(out).toContain('# Interview transcript');
    expect(out).toContain('Q (claude): who?');
    expect(out).toContain('A: internal only');
  });

  it('surfaces rejected edits from the agent\'s prior turn for retry', () => {
    let s = debating();
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: 'seeding',
      edits: [{ find: '', replace: '# Spec\n\nGoal: x' }],
      verdict: 'continue',
      timestamp: T1,
    });
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'codex',
      commentary: 'reacting',
      edits: [],
      verdict: 'continue',
      timestamp: T2,
    });
    // Claude's next turn — submit an edit that won't match anything.
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: 'try',
      edits: [{ find: 'NONEXISTENT', replace: 'x' }],
      verdict: 'continue',
      timestamp: T3,
    });
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'codex',
      commentary: 'noop',
      edits: [],
      verdict: 'continue',
      timestamp: T4,
    });
    const out = debatePrompt({ state: s, speaker: 'claude' });
    expect(out).toContain('previous edits that did NOT apply');
    expect(out).toContain('NONEXISTENT');
  });

  it('omits the rejected-edits section when there are none in the prior own turn', () => {
    let s = debating();
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: '',
      edits: [{ find: '', replace: '# Spec' }],
      verdict: 'continue',
      timestamp: T1,
    });
    const out = debatePrompt({ state: s, speaker: 'codex' });
    expect(out).not.toContain('previous edits that did NOT apply');
  });

  it('reminds the agent if it has already lgtm\'d this round', () => {
    let s = debating();
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: 'lgtm',
      edits: [],
      verdict: 'lgtm',
      timestamp: T1,
    });
    // Round still open (codex hasn't spoken). Build prompt for claude's next
    // turn — but that won't happen mid-round; build for a synthetic state.
    expect(s.lgtmThisRound).toContain('claude');
    const out = debatePrompt({ state: s, speaker: 'claude' });
    expect(out).toContain("already lgtm'd this round");
  });

  it('shows only the most recent debate turns (window of 6)', () => {
    // Build the state directly so we can include 10 debate turns without
    // tripping the termination signals (decay/max_rounds) the reducer
    // would otherwise apply.
    const s: State = {
      ...debating(),
      debate: Array.from({ length: 10 }, (_, i) => ({
        speaker: (i % 2 === 0 ? 'claude' : 'codex') as 'claude' | 'codex',
        commentary: `turn ${i}`,
        edits: [],
        applied: [],
        rejected: [],
        verdict: 'continue' as const,
        charsChanged: 0,
        round: Math.floor(i / 2) + 1,
        timestamp: new Date(Date.parse(T1) + i * 1000).toISOString(),
      })),
    };
    const out = debatePrompt({ state: s, speaker: 'claude' });
    expect(out).toContain('turn 9');
    expect(out).not.toContain('turn 0');
  });
});
