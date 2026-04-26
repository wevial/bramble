import { describe, it, expect } from 'vitest';
import { parseSlashCommand } from './commands.js';

describe('parseSlashCommand', () => {
  it('returns null for non-slash input', () => {
    expect(parseSlashCommand('hello world')).toBeNull();
    expect(parseSlashCommand('')).toBeNull();
    expect(parseSlashCommand('  no slash here')).toBeNull();
  });

  it('parses /quit and /q as quit', () => {
    expect(parseSlashCommand('/quit')).toEqual({ kind: 'quit' });
    expect(parseSlashCommand('/q')).toEqual({ kind: 'quit' });
    expect(parseSlashCommand('  /quit  ')).toEqual({ kind: 'quit' });
  });

  it('parses /done', () => {
    expect(parseSlashCommand('/done')).toEqual({ kind: 'done' });
  });

  it('parses /rounds N with a valid positive integer', () => {
    expect(parseSlashCommand('/rounds 5')).toEqual({ kind: 'rounds', value: 5 });
    expect(parseSlashCommand('/rounds 1')).toEqual({ kind: 'rounds', value: 1 });
    expect(parseSlashCommand('/rounds   12  ')).toEqual({ kind: 'rounds', value: 12 });
  });

  it('parses /rounds with no arg as a query', () => {
    expect(parseSlashCommand('/rounds')).toEqual({ kind: 'rounds', value: null });
  });

  it('rejects /rounds with non-positive or non-integer values', () => {
    expect(parseSlashCommand('/rounds 0')).toMatchObject({ kind: 'unknown' });
    expect(parseSlashCommand('/rounds -1')).toMatchObject({ kind: 'unknown' });
    expect(parseSlashCommand('/rounds abc')).toMatchObject({ kind: 'unknown' });
    expect(parseSlashCommand('/rounds 1.5')).toMatchObject({ kind: 'unknown' });
  });

  it('parses /threshold N', () => {
    expect(parseSlashCommand('/threshold 100')).toEqual({
      kind: 'threshold',
      value: 100,
    });
    expect(parseSlashCommand('/threshold 0')).toMatchObject({ kind: 'unknown' });
    expect(parseSlashCommand('/threshold')).toMatchObject({ kind: 'unknown' });
  });

  it('parses /decay N', () => {
    expect(parseSlashCommand('/decay 3')).toEqual({ kind: 'decay', value: 3 });
    expect(parseSlashCommand('/decay 0')).toMatchObject({ kind: 'unknown' });
  });

  it('returns unknown for unrecognised slash commands', () => {
    expect(parseSlashCommand('/foo')).toEqual({
      kind: 'unknown',
      raw: '/foo',
      hint: expect.any(String),
    });
    expect(parseSlashCommand('/')).toMatchObject({ kind: 'unknown' });
  });
});
