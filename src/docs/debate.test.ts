import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDebateLedger } from './debate.js';
import type { DebateTurn } from '../orchestrator/state.js';

let tmp: string;
let path: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bramble-debate-'));
  path = join(tmp, 'debate.md');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const T = '2026-04-25T00:00:00.000Z';

describe('writeDebateLedger', () => {
  it('writes empty content for no turns', async () => {
    await writeDebateLedger(path, []);
    expect(readFileSync(path, 'utf8')).toBe('');
  });

  it('renders one turn with header, commentary, and applied diff blocks', async () => {
    const turn: DebateTurn = {
      speaker: 'claude',
      commentary: 'tightening goals',
      edits: [{ find: 'TBD', replace: 'Ship a CLI' }],
      applied: [{ find: 'TBD', replace: 'Ship a CLI' }],
      rejected: [],
      verdict: 'continue',
      charsChanged: 13,
      round: 1,
      timestamp: T,
    };
    await writeDebateLedger(path, [turn]);
    const out = readFileSync(path, 'utf8');
    expect(out).toContain('## claude · round 1 · continue');
    expect(out).toContain('tightening goals');
    expect(out).toContain('applied (1)');
    expect(out).toContain('```diff');
    expect(out).toContain('- TBD');
    expect(out).toContain('+ Ship a CLI');
  });

  it('shows rejected edits with their reason and count', async () => {
    const turn: DebateTurn = {
      speaker: 'codex',
      commentary: 'tried two edits, neither matched',
      edits: [
        { find: 'foo', replace: 'bar' },
        { find: 'baz', replace: 'qux' },
      ],
      applied: [],
      rejected: [
        { kind: 'no_match', edit: { find: 'foo', replace: 'bar' }, count: 0 },
        { kind: 'ambiguous', edit: { find: 'baz', replace: 'qux' }, count: 3 },
      ],
      verdict: 'continue',
      charsChanged: 0,
      round: 2,
      timestamp: T,
    };
    await writeDebateLedger(path, [turn]);
    const out = readFileSync(path, 'utf8');
    expect(out).toContain('rejected (2)');
    expect(out).toContain('no_match (0 matches)');
    expect(out).toContain('ambiguous (3 matches)');
  });

  it('separates multiple turns with a horizontal rule', async () => {
    const t1: DebateTurn = {
      speaker: 'claude',
      commentary: 'first',
      edits: [],
      applied: [],
      rejected: [],
      verdict: 'continue',
      charsChanged: 0,
      round: 1,
      timestamp: T,
    };
    const t2: DebateTurn = { ...t1, speaker: 'codex', commentary: 'second' };
    await writeDebateLedger(path, [t1, t2]);
    const out = readFileSync(path, 'utf8');
    expect(out).toContain('first');
    expect(out).toContain('second');
    expect(out).toContain('---');
  });
});
