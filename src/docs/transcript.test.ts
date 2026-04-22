import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendTurn, readTranscript } from './transcript.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bramble-tx-'));
  file = join(dir, 'transcript.jsonl');
});

describe('transcript.jsonl', () => {
  it('creates the file on first append', async () => {
    expect(existsSync(file)).toBe(false);
    await appendTurn(file, { speaker: 'claude', content: 'hi', timestamp: 't1' });
    expect(existsSync(file)).toBe(true);
  });

  it('appends one JSON object per line', async () => {
    await appendTurn(file, { speaker: 'claude', content: 'a', timestamp: 't1' });
    await appendTurn(file, { speaker: 'codex', content: 'b', timestamp: 't2' });
    const raw = readFileSync(file, 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ speaker: 'claude', content: 'a', timestamp: 't1' });
    expect(JSON.parse(lines[1]!)).toEqual({ speaker: 'codex', content: 'b', timestamp: 't2' });
  });

  it('readTranscript round-trips the appended records in order', async () => {
    await appendTurn(file, { speaker: 'claude', content: 'a', timestamp: 't1' });
    await appendTurn(file, { speaker: 'user', content: 'b', timestamp: 't2' });
    await appendTurn(file, { speaker: 'codex', content: 'c', timestamp: 't3' });
    const records = await readTranscript(file);
    expect(records.map(r => r.content)).toEqual(['a', 'b', 'c']);
  });

  it('readTranscript returns empty when file does not exist', async () => {
    expect(await readTranscript(file)).toEqual([]);
  });

  it('handles newlines inside content by escaping in JSON', async () => {
    await appendTurn(file, { speaker: 'claude', content: 'line1\nline2', timestamp: 't1' });
    const records = await readTranscript(file);
    expect(records[0]!.content).toBe('line1\nline2');
  });
});
