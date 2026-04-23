import { describe, it, expect } from 'vitest';
import { classifyLine, parseInline } from './markdown.js';

describe('classifyLine', () => {
  it('detects ATX headings at each level', () => {
    expect(classifyLine('# Title')).toMatchObject({ kind: 'heading', level: 1, content: 'Title' });
    expect(classifyLine('### Sub')).toMatchObject({ kind: 'heading', level: 3 });
  });

  it('detects - and * bullets', () => {
    expect(classifyLine('- hi')).toMatchObject({ kind: 'bullet', bullet: '-', content: 'hi' });
    expect(classifyLine('  * nested')).toMatchObject({
      kind: 'bullet',
      indent: '  ',
      bullet: '*',
      content: 'nested',
    });
  });

  it('leaves plain text as plain', () => {
    expect(classifyLine('just words here')).toEqual({
      kind: 'plain',
      content: 'just words here',
    });
  });
});

describe('parseInline', () => {
  it('extracts inline code spans', () => {
    const s = parseInline('use `foo()` here');
    expect(s).toEqual([
      { text: 'use ' },
      { text: 'foo()', code: true },
      { text: ' here' },
    ]);
  });

  it('extracts bold', () => {
    const s = parseInline('**loud** quiet');
    expect(s[0]).toMatchObject({ text: 'loud', bold: true });
  });

  it('extracts italic via * and _', () => {
    expect(parseInline('*a*')[0]).toMatchObject({ text: 'a', italic: true });
    expect(parseInline('_b_')[0]).toMatchObject({ text: 'b', italic: true });
  });

  it('does not confuse ** with *', () => {
    const s = parseInline('**bold**');
    expect(s).toEqual([{ text: 'bold', bold: true }]);
  });

  it('returns plain text for non-markdown', () => {
    expect(parseInline('plain words')).toEqual([{ text: 'plain words' }]);
  });
});
