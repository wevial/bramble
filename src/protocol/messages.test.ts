import { describe, it, expect } from 'vitest';
import {
  parseInterviewMessage,
  parseDebateMessage,
  applyEdits,
} from './messages.js';

describe('parseInterviewMessage', () => {
  it('parses a question turn', () => {
    const r = parseInterviewMessage(
      JSON.stringify({
        commentary: 'I want to scope authentication first.',
        question: 'Who are the users — internal only, or public signups?',
        ready: false,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.question).toMatch(/Who are the users/);
    expect(r.value.ready).toBe(false);
  });

  it('parses a ready signal with no question', () => {
    const r = parseInterviewMessage(
      JSON.stringify({
        commentary: 'I have what I need.',
        question: null,
        ready: true,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.ready).toBe(true);
    expect(r.value.question).toBeNull();
  });

  it('treats omitted question as null', () => {
    const r = parseInterviewMessage(
      JSON.stringify({ commentary: 'enough', ready: true }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.question).toBeNull();
  });

  it('rejects ready with non-boolean type', () => {
    const r = parseInterviewMessage(
      JSON.stringify({ commentary: 'x', ready: 'yes' }),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects missing commentary', () => {
    const r = parseInterviewMessage(JSON.stringify({ ready: true }));
    expect(r.ok).toBe(false);
  });

  it('rejects malformed JSON', () => {
    const r = parseInterviewMessage('not json {');
    expect(r.ok).toBe(false);
  });

  it('extracts JSON object embedded in surrounding prose', () => {
    const raw =
      'Here is my next interview turn:\n\n{"commentary": "ok", "question": "what?", "ready": false}\n\nThanks.';
    const r = parseInterviewMessage(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.question).toBe('what?');
  });

  it('extracts JSON wrapped in code fences', () => {
    const raw =
      '```json\n{"commentary": "fenced", "question": "x?", "ready": false}\n```';
    const r = parseInterviewMessage(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.commentary).toBe('fenced');
  });

  it('uses balanced-brace matching when JSON is followed by trailing prose', () => {
    // The naive lastIndexOf('}') approach would consume the trailing brace
    // in the prose and fail JSON.parse. The balanced extractor stops at the
    // matching close brace.
    const raw =
      '{"commentary": "ok", "question": "what?", "ready": false}\nNote: see also {something else}.';
    const r = parseInterviewMessage(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.question).toBe('what?');
  });
});

describe('parseDebateMessage', () => {
  it('parses a debate turn with edits', () => {
    const r = parseDebateMessage(
      JSON.stringify({
        commentary: 'Tightening the goals section.',
        edits: [{ find: '## Goals\nTBD', replace: '## Goals\nShip a CLI.' }],
        verdict: 'continue',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.edits).toHaveLength(1);
    expect(r.value.verdict).toBe('continue');
  });

  it('parses a commentary-only LGTM turn (no edits)', () => {
    const r = parseDebateMessage(
      JSON.stringify({ commentary: 'looks good', edits: [], verdict: 'lgtm' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.edits).toEqual([]);
    expect(r.value.verdict).toBe('lgtm');
  });

  it('treats omitted edits as empty array', () => {
    const r = parseDebateMessage(
      JSON.stringify({ commentary: 'hm', verdict: 'continue' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.edits).toEqual([]);
  });

  it('rejects unknown verdict', () => {
    const r = parseDebateMessage(
      JSON.stringify({ commentary: 'x', edits: [], verdict: 'maybe' }),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects missing verdict', () => {
    const r = parseDebateMessage(
      JSON.stringify({ commentary: 'x', edits: [] }),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects edit with missing replace field', () => {
    const r = parseDebateMessage(
      JSON.stringify({
        commentary: 'x',
        edits: [{ find: 'a' }],
        verdict: 'continue',
      }),
    );
    expect(r.ok).toBe(false);
  });

  it('extracts JSON embedded in prose', () => {
    const raw =
      'My turn:\n{"commentary":"x","edits":[],"verdict":"lgtm"}\nDone.';
    const r = parseDebateMessage(raw);
    expect(r.ok).toBe(true);
  });
});

describe('applyEdits', () => {
  it('applies a single matching edit', () => {
    const result = applyEdits('# Spec\n\n## Goals\nTBD', [
      { find: 'TBD', replace: 'Ship a CLI.' },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.applied).toHaveLength(1);
    expect(result.newSpec).toBe('# Spec\n\n## Goals\nShip a CLI.');
  });

  it('rejects an edit whose find appears zero times', () => {
    const result = applyEdits('hello world', [
      { find: 'goodbye', replace: 'hi' },
    ]);
    expect(result.applied).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.kind).toBe('no_match');
    expect(result.rejected[0]!.count).toBe(0);
    expect(result.newSpec).toBe('hello world');
  });

  it('rejects an edit whose find appears more than once', () => {
    const result = applyEdits('foo foo foo', [
      { find: 'foo', replace: 'bar' },
    ]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.kind).toBe('ambiguous');
    expect(result.rejected[0]!.count).toBe(3);
    expect(result.newSpec).toBe('foo foo foo');
  });

  it('appends to end when find is empty on a non-empty spec', () => {
    const result = applyEdits('# Spec\n', [
      { find: '', replace: '\n## New\nbody\n' },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.newSpec).toBe('# Spec\n\n## New\nbody\n');
  });

  it('appends to seed an empty spec when find is empty', () => {
    const result = applyEdits('', [
      { find: '', replace: '# Spec\n\n## Goals\nDraft.' },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.newSpec).toBe('# Spec\n\n## Goals\nDraft.');
  });

  it('rejects a non-empty find against an empty spec', () => {
    const result = applyEdits('', [{ find: 'anything', replace: 'x' }]);
    expect(result.applied).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.kind).toBe('no_match');
    expect(result.newSpec).toBe('');
  });

  it('applies multiple edits sequentially against the evolving spec', () => {
    const result = applyEdits('one\ntwo\nthree', [
      { find: 'one', replace: 'ONE' },
      { find: 'two', replace: 'TWO' },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.newSpec).toBe('ONE\nTWO\nthree');
  });

  it('lets a later edit target text introduced by an earlier edit in the same turn', () => {
    const result = applyEdits('placeholder', [
      { find: 'placeholder', replace: 'first inserted second\nmarker' },
      { find: 'marker', replace: 'final' },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.newSpec).toBe('first inserted second\nfinal');
  });

  it('still applies remaining edits when one rejects', () => {
    const result = applyEdits('alpha beta', [
      { find: 'gamma', replace: 'x' },
      { find: 'beta', replace: 'BETA' },
    ]);
    expect(result.rejected).toHaveLength(1);
    expect(result.applied).toHaveLength(1);
    expect(result.newSpec).toBe('alpha BETA');
  });

  it('charsChanged sums |find| + |replace| for each applied edit', () => {
    const result = applyEdits('hello world', [
      { find: 'hello', replace: 'hi' }, // 5 + 2 = 7
      { find: 'world', replace: 'planet' }, // 5 + 6 = 11
    ]);
    expect(result.charsChanged).toBe(7 + 11);
  });

  it('charsChanged ignores rejected edits', () => {
    const result = applyEdits('foo foo', [
      { find: 'foo', replace: 'BAR' },
      { find: 'baz', replace: 'X' },
    ]);
    // both edits rejected (foo ambiguous, baz no_match)
    expect(result.charsChanged).toBe(0);
  });
});
