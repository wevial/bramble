import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { SpecPane, specStats } from './SpecPane.js';

describe('specStats', () => {
  it('zeroes out for empty text', () => {
    expect(specStats('')).toEqual({ lines: 0, words: 0, chars: 0 });
  });

  it('counts lines, words, and chars on a simple body', () => {
    const s = specStats('one two\nthree');
    expect(s).toEqual({ lines: 2, words: 3, chars: 13 });
  });
});

describe('SpecPane', () => {
  it('shows an empty hint when the body is empty', () => {
    const { lastFrame } = render(<SpecPane text="" />);
    expect(lastFrame() ?? '').toMatch(/empty/);
  });

  it('shows the title and stats footer', () => {
    const body = '# Hello\n\nworld words here';
    const { lastFrame } = render(<SpecPane text={body} title="spec.md" />);
    const out = lastFrame() ?? '';
    expect(out).toContain('spec.md');
    expect(out).toContain('Lines');
    expect(out).toContain('Words');
    expect(out).toContain('Chars');
  });
});
