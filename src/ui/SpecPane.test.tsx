import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { SpecPane, specStats, lineRangeLabel } from './SpecPane.js';

describe('specStats', () => {
  it('zeroes out for empty text', () => {
    expect(specStats('')).toEqual({ lines: 0, words: 0, chars: 0 });
  });

  it('counts lines, words, and chars on a simple body', () => {
    const s = specStats('one two\nthree');
    expect(s).toEqual({ lines: 2, words: 3, chars: 13 });
  });
});

describe('lineRangeLabel', () => {
  it('returns "Lines: 0" for an empty body', () => {
    expect(lineRangeLabel(0)).toBe('Lines: 0');
  });

  it('returns full range when not truncated', () => {
    expect(lineRangeLabel(28)).toBe('Lines: 1-28');
    expect(lineRangeLabel(28, 30)).toBe('Lines: 1-28');
  });

  it('shows visible range and total when truncated by maxLines', () => {
    expect(lineRangeLabel(120, 28)).toBe('Lines: 1-28 of 120');
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

  it('renders a custom title (e.g. README_SPEC.md)', () => {
    const { lastFrame } = render(
      <SpecPane text="# x" title="README_SPEC.md" />,
    );
    expect(lastFrame() ?? '').toContain('README_SPEC.md');
  });

  it('renders the auto-save indicator when saving', () => {
    const { lastFrame } = render(
      <SpecPane text="# x" saveStatus="saving" />,
    );
    expect(lastFrame() ?? '').toMatch(/Auto-saving/);
  });

  it('renders the mode pill in the footer', () => {
    const { lastFrame } = render(
      <SpecPane text="# x" mode={{ label: 'DRAFT', color: 'cyan' }} />,
    );
    expect(lastFrame() ?? '').toContain('DRAFT');
  });

  it('shows truncation in the line label when maxLines crops the body', () => {
    const body = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    const { lastFrame } = render(<SpecPane text={body} maxLines={10} />);
    expect(lastFrame() ?? '').toMatch(/Lines: 1-10 of 50/);
  });
});
