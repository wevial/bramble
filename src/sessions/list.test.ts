import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSessions } from './list.js';

function mk() {
  return mkdtempSync(join(tmpdir(), 'bramble-list-'));
}

function seed(root: string, name: string, files: Record<string, string>) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) {
    writeFileSync(join(dir, f), body);
  }
  return dir;
}

describe('listSessions', () => {
  it('returns [] for an empty root', async () => {
    expect(await listSessions(mk())).toEqual([]);
  });

  it('returns [] when root does not exist', async () => {
    expect(await listSessions('/no/such/dir/zzz')).toEqual([]);
  });

  it('derives name/turns/goal/accepted from a session directory', async () => {
    const root = mk();
    seed(root, 'purple-alpaca', {
      'transcript.jsonl':
        '{"speaker":"claude","content":"hi","timestamp":1}\n' +
        '{"speaker":"codex","content":"ok","timestamp":2}\n' +
        '{"speaker":"user","content":"wait","timestamp":3}\n',
      'prompt.txt': 'design auth',
      'spec.md': '# Auth\n\n- password',
    });

    const rows = await listSessions(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('purple-alpaca');
    expect(rows[0]!.turns).toBe(3);
    expect(rows[0]!.goal).toBe('design auth');
    expect(rows[0]!.accepted).toBe(true);
  });

  it('sorts by transcript mtime, newest first', async () => {
    const root = mk();
    const a = seed(root, 'a', { 'transcript.jsonl': '' });
    const b = seed(root, 'b', { 'transcript.jsonl': '' });
    utimesSync(join(a, 'transcript.jsonl'), new Date('2020-01-01'), new Date('2020-01-01'));
    utimesSync(join(b, 'transcript.jsonl'), new Date('2026-01-01'), new Date('2026-01-01'));

    const rows = await listSessions(root);
    expect(rows.map(r => r.name)).toEqual(['b', 'a']);
  });

  it('skips subdirs without transcript.jsonl', async () => {
    const root = mk();
    mkdirSync(join(root, 'not-a-session'), { recursive: true });
    seed(root, 'real', { 'transcript.jsonl': '' });
    const rows = await listSessions(root);
    expect(rows.map(r => r.name)).toEqual(['real']);
  });

  it('handles missing prompt sidecar and empty transcript', async () => {
    const root = mk();
    seed(root, 'lonely', { 'transcript.jsonl': '' });
    const rows = await listSessions(root);
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
