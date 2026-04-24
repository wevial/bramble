import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSessions } from './list.js';

function mk() {
  return mkdtempSync(join(tmpdir(), 'bramble-list-'));
}

describe('listSessions', () => {
  it('returns [] for an empty directory', async () => {
    const dir = mk();
    expect(await listSessions(dir)).toEqual([]);
  });

  it('derives name/turns/goal/accepted from session files', async () => {
    const dir = mk();
    writeFileSync(
      join(dir, 'transcript-purple-alpaca.jsonl'),
      [
        '{"speaker":"claude","content":"hi","timestamp":1}',
        '{"speaker":"codex","content":"ok","timestamp":2}',
        '{"speaker":"user","content":"wait","timestamp":3}',
      ].join('\n') + '\n',
    );
    writeFileSync(join(dir, 'prompt-purple-alpaca.txt'), 'design auth');
    writeFileSync(
      join(dir, 'spec-purple-alpaca.md'),
      '# Auth\n\n- password',
    );

    const rows = await listSessions(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('purple-alpaca');
    expect(rows[0]!.turns).toBe(3);
    expect(rows[0]!.goal).toBe('design auth');
    expect(rows[0]!.accepted).toBe(true);
  });

  it('sorts by transcript mtime, newest first', async () => {
    const dir = mk();
    const a = join(dir, 'transcript-a.jsonl');
    const b = join(dir, 'transcript-b.jsonl');
    writeFileSync(a, '');
    writeFileSync(b, '');
    utimesSync(a, new Date('2020-01-01'), new Date('2020-01-01'));
    utimesSync(b, new Date('2026-01-01'), new Date('2026-01-01'));

    const rows = await listSessions(dir);
    expect(rows.map(r => r.name)).toEqual(['b', 'a']);
  });

  it('handles missing prompt sidecar and empty transcript', async () => {
    const dir = mk();
    writeFileSync(join(dir, 'transcript-lonely.jsonl'), '');
    const rows = await listSessions(dir);
    expect(rows).toEqual([
      expect.objectContaining({
        name: 'lonely',
        turns: 0,
        goal: '',
        accepted: false,
      }),
    ]);
  });
});
