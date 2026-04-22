import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDebate, readDebate, clearDebate } from './debate.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bramble-debate-'));
  file = join(dir, 'debate.md');
});

describe('debate.md (rewritten each turn)', () => {
  it('writeDebate overwrites prior content', async () => {
    await writeDebate(file, [
      { speaker: 'claude', content: 'v1' },
    ]);
    await writeDebate(file, [
      { speaker: 'claude', content: 'v1' },
      { speaker: 'codex', content: 'v2' },
    ]);
    const raw = readFileSync(file, 'utf8');
    expect(raw).toContain('v1');
    expect(raw).toContain('v2');
    // only one '## claude' heading even though v1 was written twice
    expect((raw.match(/## claude/g) ?? []).length).toBe(1);
  });

  it('readDebate returns empty string when file missing', async () => {
    expect(await readDebate(file)).toBe('');
  });

  it('clearDebate empties the file', async () => {
    await writeDebate(file, [{ speaker: 'codex', content: 'x' }]);
    await clearDebate(file);
    expect(await readDebate(file)).toBe('');
    expect(existsSync(file)).toBe(true);
  });

  it('renders each entry with its speaker heading in order', async () => {
    await writeDebate(file, [
      { speaker: 'claude', content: 'propose X' },
      { speaker: 'user', content: 'what about Y?' },
      { speaker: 'codex', content: 'critique of X' },
    ]);
    const raw = readFileSync(file, 'utf8');
    const claudeIdx = raw.indexOf('## claude');
    const userIdx = raw.indexOf('## user');
    const codexIdx = raw.indexOf('## codex');
    expect(claudeIdx).toBeGreaterThan(-1);
    expect(userIdx).toBeGreaterThan(claudeIdx);
    expect(codexIdx).toBeGreaterThan(userIdx);
  });
});
