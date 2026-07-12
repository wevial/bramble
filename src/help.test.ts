import { describe, it, expect } from 'bun:test';
import { helpText } from './help.js';

describe('helpText', () => {
  const text = helpText();

  it('starts with the one-liner and usage block', () => {
    expect(text).toMatch(/^bramble — agents debate to produce a spec/);
    expect(text).toContain('Usage:');
  });

  it('documents every flag the CLI actually accepts', () => {
    const expected = [
      '--rounds',
      '--auto',
      '--collab',
      '--mock',
      '--moderator',
      '--no-moderator',
      '--interview',
      '--test',
      '--claude-model',
      '--claude-effort',
      '--codex-model',
      '--codex-effort',
      '--isolated',
      '--autopilot',
      '--autopilot-answers',
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

  it('documents the mcp subcommand and its tools', () => {
    expect(text).toContain('bramble mcp');
    expect(text).toContain('bramble_start');
    expect(text).toContain('bramble_get_spec');
    expect(text).toContain('claude mcp add bramble');
  });

  it('mentions the key TUI shortcuts a new user needs', () => {
    expect(text).toMatch(/Tab/);
    expect(text).toMatch(/Ctrl-o/);
    expect(text).toMatch(/\/export/);
    expect(text).toMatch(/\/copy/);
  });
});
