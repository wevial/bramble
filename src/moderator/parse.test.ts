import { describe, it, expect } from 'vitest';
import { parseModeratorPick } from './parse.js';

const ELIGIBLE = ['claude', 'codex', 'security'];

describe('parseModeratorPick', () => {
  it('parses a clean single-line JSON object', () => {
    const r = parseModeratorPick(
      '{"next":"security","reason":"auth section needs review"}',
      ELIGIBLE,
    );
    expect(r).toEqual({ next: 'security', reason: 'auth section needs review' });
  });

  it('extracts JSON from inside code fences', () => {
    const r = parseModeratorPick(
      '```json\n{"next":"claude","reason":"recap"}\n```',
      ELIGIBLE,
    );
    expect(r?.next).toBe('claude');
  });

  it('extracts JSON when wrapped in prose', () => {
    const r = parseModeratorPick(
      'Sure! Here is my pick: {"next":"codex","reason":"perf concern"} — done.',
      ELIGIBLE,
    );
    expect(r?.next).toBe('codex');
  });

  it('returns null when next is not in the eligible list', () => {
    expect(parseModeratorPick('{"next":"ghost","reason":"x"}', ELIGIBLE)).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(parseModeratorPick('not json at all', ELIGIBLE)).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(parseModeratorPick('', ELIGIBLE)).toBeNull();
  });

  it('tolerates a missing reason', () => {
    const r = parseModeratorPick('{"next":"claude"}', ELIGIBLE);
    expect(r).toEqual({ next: 'claude', reason: '' });
  });
});
