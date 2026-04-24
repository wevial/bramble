import { describe, it, expect } from 'vitest';
import { helpText } from './help.js';

describe('helpText', () => {
  const text = helpText();

  it('starts with the one-liner and usage block', () => {
    expect(text).toMatch(/^bramble — two agents debate to produce a spec/);
    expect(text).toContain('Usage:');
  });

  it('documents every flag the CLI actually accepts', () => {
    const expected = [
      '--rounds',
      '--auto',
      '--collab',
      '--real',
      '--test',
      '--claude-model',
      '--codex-model',
      '--codex-effort',
      '--isolated',
      '--name',
      '--resume',
      '--list',
      '--dir',
      '--help',
      '-h',
    ];
    for (const flag of expected) {
      expect(text).toContain(flag);
    }
  });

  it('mentions the key TUI shortcuts a new user needs', () => {
    expect(text).toMatch(/Tab/);
    expect(text).toMatch(/Ctrl-o/);
    expect(text).toMatch(/\/export/);
    expect(text).toMatch(/\/copy/);
  });
});
