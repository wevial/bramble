import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendSpecTurn, clearSpec, readSpec } from './spec.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bramble-spec-'));
  file = join(dir, 'spec.md');
});

describe('spec.md (Phase 1: append-only placeholder)', () => {
  it('creates the file on first append', async () => {
    expect(existsSync(file)).toBe(false);
    await appendSpecTurn(file, { speaker: 'claude', content: 'a proposal' });
    expect(existsSync(file)).toBe(true);
  });

  it('writes each turn as a labelled markdown block', async () => {
    await appendSpecTurn(file, { speaker: 'claude', content: 'start with email+pw' });
    await appendSpecTurn(file, { speaker: 'codex', content: 'counter: OAuth day 1' });
    const raw = readFileSync(file, 'utf8');
    expect(raw).toContain('## claude');
    expect(raw).toContain('start with email+pw');
    expect(raw).toContain('## codex');
    expect(raw).toContain('counter: OAuth day 1');
    expect(raw.indexOf('## claude')).toBeLessThan(raw.indexOf('## codex'));
  });

  it('readSpec returns empty when file does not exist', async () => {
    expect(await readSpec(file)).toBe('');
  });

  it('clearSpec empties the file without deleting it', async () => {
    await appendSpecTurn(file, { speaker: 'claude', content: 'x' });
    await clearSpec(file);
    expect(await readSpec(file)).toBe('');
    expect(existsSync(file)).toBe(true);
  });
});
