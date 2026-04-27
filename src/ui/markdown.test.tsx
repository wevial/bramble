import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import {
  classifyLine,
  MarkdownBlock,
  parseInline,
  visibleLength,
} from './markdown.js';

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

  it('drops an unmatched inline code delimiter and leaves the content plain', () => {
    expect(parseInline('use `foo here')).toEqual([
      { text: 'use foo here' },
    ]);
  });
});

describe('MarkdownBlock', () => {
  it('hides fence marker lines and renders fenced content as code', () => {
    const { lastFrame, unmount } = render(
      <MarkdownBlock text={'before\n```ts\nconst x = 1;\n```\nafter'} />,
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('before');
    expect(frame).toContain('const x = 1;');
    expect(frame).toContain('after');
    expect(frame).not.toContain('```');
    unmount();
  });
});

describe('visibleLength', () => {
  it('treats fence marker lines as zero-width', () => {
    expect(visibleLength('```ts')).toBe(0);
    expect(visibleLength('```')).toBe(0);
  });
});
