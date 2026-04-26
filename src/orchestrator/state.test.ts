import { describe, it, expect } from 'vitest';
import { initialState, reducer, type State } from './state.js';

const T = '2026-04-25T00:00:00.000Z';

function fresh(overrides: Partial<State> = {}): State {
  return { ...initialState('design x'), ...overrides };
}

describe('reducer — interview phase', () => {
  it('appends an interview turn and stores the ready vote', () => {
    const s1 = reducer(fresh(), {
      type: 'interviewTurn',
      timestamp: T,
      turn: {
        speaker: 'claude',
        commentary: 'starting',
        question: 'who?',
        ready: false,
      },
    });
    expect(s1.interview).toHaveLength(1);
    expect(s1.interview[0]!.question).toBe('who?');
    expect(s1.readyAgents).toEqual([]);
    expect(s1.phase).toBe('interview');
  });

  it('flips phase to debate once both agents are ready', () => {
    let s = fresh();
    s = reducer(s, {
      type: 'interviewTurn',
      timestamp: T,
      turn: { speaker: 'claude', commentary: '', question: null, ready: true },
    });
    expect(s.phase).toBe('interview');
    s = reducer(s, {
      type: 'interviewTurn',
      timestamp: T,
      turn: { speaker: 'codex', commentary: '', question: null, ready: true },
    });
    expect(s.phase).toBe('debate');
    expect(s.readyAgents).toEqual(['claude', 'codex']);
  });

  it('lets an agent rescind a ready vote on a later turn', () => {
    let s = fresh();
    s = reducer(s, {
      type: 'interviewTurn',
      timestamp: T,
      turn: { speaker: 'claude', commentary: '', question: null, ready: true },
    });
    s = reducer(s, {
      type: 'interviewTurn',
      timestamp: T,
      turn: { speaker: 'claude', commentary: '', question: 'wait', ready: false },
    });
    expect(s.readyAgents).toEqual([]);
    expect(s.phase).toBe('interview');
  });

  it('userDone forces transition to debate from interview', () => {
    const s = reducer(fresh(), { type: 'userDone' });
    expect(s.phase).toBe('debate');
  });

  it('userDone is a no-op outside the interview phase', () => {
    const s = reducer(fresh({ phase: 'debate' }), { type: 'userDone' });
    expect(s.phase).toBe('debate');
  });

  it('userAnswer appends to userAnswers regardless of phase', () => {
    const s = reducer(fresh(), {
      type: 'userAnswer',
      content: 'internal users only',
      timestamp: T,
    });
    expect(s.userAnswers).toHaveLength(1);
    expect(s.userAnswers[0]!.content).toBe('internal users only');
  });

  it('ignores debateTurn while still in interview phase', () => {
    const s = reducer(fresh(), {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: '',
      edits: [{ find: '', replace: '# Spec' }],
      verdict: 'continue',
      timestamp: T,
    });
    expect(s.spec).toBe('');
    expect(s.debate).toEqual([]);
  });
});

describe('reducer — debate phase', () => {
  function debating(overrides: Partial<State> = {}): State {
    return fresh({ phase: 'debate', ...overrides });
  }

  it('applies edits and tracks the round number', () => {
    const s = reducer(debating(), {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: 'seeding',
      edits: [{ find: '', replace: '# Spec\n\n## Goals\nTBD' }],
      verdict: 'continue',
      timestamp: T,
    });
    expect(s.spec).toBe('# Spec\n\n## Goals\nTBD');
    expect(s.debate).toHaveLength(1);
    expect(s.debate[0]!.round).toBe(1);
    expect(s.debate[0]!.applied).toHaveLength(1);
    expect(s.round).toBe(1);
  });

  it('records rejected edits and leaves the spec unchanged', () => {
    const s = reducer(debating({ spec: '# Spec' }), {
      type: 'debateTurn',
      speaker: 'codex',
      commentary: 'oops',
      edits: [{ find: 'missing', replace: 'x' }],
      verdict: 'continue',
      timestamp: T,
    });
    expect(s.spec).toBe('# Spec');
    expect(s.debate[0]!.rejected).toHaveLength(1);
    expect(s.debate[0]!.applied).toEqual([]);
  });

  it('keeps two same-round turns in the same round number', () => {
    let s = debating();
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: '',
      edits: [{ find: '', replace: 'a' }],
      verdict: 'continue',
      timestamp: T,
    });
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'codex',
      commentary: '',
      edits: [{ find: 'a', replace: 'ab' }],
      verdict: 'continue',
      timestamp: T,
    });
    expect(s.debate.map(d => d.round)).toEqual([1, 1]);
    expect(s.round).toBe(1);
    expect(s.roundVolumes).toEqual([1 + 1 + 2]); // claude appended 1 char + codex (1+2)
  });

  it('opens a new round when the same speaker speaks twice', () => {
    let s = debating();
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: '',
      edits: [{ find: '', replace: 'x' }],
      verdict: 'continue',
      timestamp: T,
    });
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: '',
      edits: [{ find: 'x', replace: 'y' }],
      verdict: 'continue',
      timestamp: T,
    });
    expect(s.debate.map(d => d.round)).toEqual([1, 2]);
  });

  it('terminates with mutual_lgtm when both agents lgtm in the same round', () => {
    let s = debating();
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: 'good draft',
      edits: [{ find: '', replace: '# Spec' }],
      verdict: 'lgtm',
      timestamp: T,
    });
    expect(s.phase).toBe('debate');
    expect(s.lgtmThisRound).toEqual(['claude']);
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'codex',
      commentary: 'agree',
      edits: [],
      verdict: 'lgtm',
      timestamp: T,
    });
    expect(s.phase).toBe('done');
    expect(s.endReason).toBe('mutual_lgtm');
  });

  it('does NOT terminate when only one agent has lgtmd at round close', () => {
    let s = debating();
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: '',
      edits: [{ find: '', replace: 'big initial draft body here' }],
      verdict: 'lgtm',
      timestamp: T,
    });
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'codex',
      commentary: '',
      edits: [{ find: 'body', replace: 'BODY' }],
      verdict: 'continue',
      timestamp: T,
    });
    expect(s.phase).toBe('debate');
    // LGTM accumulator resets at the round boundary.
    expect(s.lgtmThisRound).toEqual([]);
  });

  it('terminates with edit_decay when 2 consecutive rounds stay below threshold', () => {
    let s = debating({
      spec: 'aaaa bbbb cccc dddd', // 19 chars
    });
    // Round 1: large edit (above threshold)
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: '',
      edits: [
        { find: 'aaaa bbbb cccc dddd', replace: 'WHOLE NEW BODY OF SPEC HERE — TONS OF CHARS BEING REWRITTEN' },
      ],
      verdict: 'continue',
      timestamp: T,
    });
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'codex',
      commentary: '',
      edits: [],
      verdict: 'continue',
      timestamp: T,
    });
    // Round 2: small edit (below threshold of 50)
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: '',
      edits: [{ find: 'TONS', replace: 'tons' }],
      verdict: 'continue',
      timestamp: T,
    });
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'codex',
      commentary: '',
      edits: [],
      verdict: 'continue',
      timestamp: T,
    });
    expect(s.phase).toBe('debate'); // only one decay round so far
    // Round 3: another small edit
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: '',
      edits: [{ find: 'WHOLE', replace: 'whole' }],
      verdict: 'continue',
      timestamp: T,
    });
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'codex',
      commentary: '',
      edits: [],
      verdict: 'continue',
      timestamp: T,
    });
    expect(s.phase).toBe('done');
    expect(s.endReason).toBe('edit_decay');
  });

  it('terminates with max_rounds when the cap is hit and no other signal fires', () => {
    let s = debating({
      config: { maxRounds: 2, decayThreshold: 50, decayWindow: 2 },
      spec: 'aaaa bbbb cccc dddd eeee ffff gggg hhhh',
    });
    // Big enough edit volumes each round to avoid decay.
    const bigEdit = (find: string, replace: string) => ({ find, replace });
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: '',
      edits: [bigEdit('aaaa', 'AAAA-PADDING-LOTS-OF-CHARS-HERE')],
      verdict: 'continue',
      timestamp: T,
    });
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'codex',
      commentary: '',
      edits: [bigEdit('bbbb', 'BBBB-PADDING-LOTS-OF-CHARS-HERE')],
      verdict: 'continue',
      timestamp: T,
    });
    expect(s.phase).toBe('debate');
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'claude',
      commentary: '',
      edits: [bigEdit('cccc', 'CCCC-PADDING-LOTS-OF-CHARS-HERE')],
      verdict: 'continue',
      timestamp: T,
    });
    s = reducer(s, {
      type: 'debateTurn',
      speaker: 'codex',
      commentary: '',
      edits: [bigEdit('dddd', 'DDDD-PADDING-LOTS-OF-CHARS-HERE')],
      verdict: 'continue',
      timestamp: T,
    });
    expect(s.phase).toBe('done');
    expect(s.endReason).toBe('max_rounds');
  });

  it('userEdit replaces the spec and resets decay history', () => {
    const s = reducer(
      debating({ spec: 'old', roundVolumes: [10, 10] }),
      { type: 'userEdit', newSpec: 'brand new spec' },
    );
    expect(s.spec).toBe('brand new spec');
    expect(s.roundVolumes).toEqual([]);
  });

  it('updateConfig merges into config', () => {
    const s = reducer(debating(), {
      type: 'updateConfig',
      patch: { maxRounds: 16, decayThreshold: 100 },
    });
    expect(s.config.maxRounds).toBe(16);
    expect(s.config.decayThreshold).toBe(100);
    expect(s.config.decayWindow).toBe(2);
  });
});
