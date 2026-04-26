import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendEntry,
  readTranscript,
  type TranscriptEntry,
} from './transcript.js';

let tmp: string;
let path: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bramble-transcript-'));
  path = join(tmp, 'transcript.jsonl');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const T = '2026-04-25T00:00:00.000Z';

describe('transcript.ts', () => {
  it('returns [] for a nonexistent file', async () => {
    expect(await readTranscript(path)).toEqual([]);
  });

  it('round-trips a session entry', async () => {
    const entry: TranscriptEntry = {
      type: 'session',
      prompt: 'design x',
      config: { maxRounds: 8, decayThreshold: 50, decayWindow: 2 },
      timestamp: T,
    };
    await appendEntry(path, entry);
    expect(await readTranscript(path)).toEqual([entry]);
  });

  it('round-trips a mix of typed entries in order', async () => {
    const entries: TranscriptEntry[] = [
      {
        type: 'session',
        prompt: 'x',
        config: { maxRounds: 8, decayThreshold: 50, decayWindow: 2 },
        timestamp: T,
      },
      {
        type: 'interview_turn',
        turn: {
          speaker: 'claude',
          commentary: 'q',
          question: 'who?',
          ready: false,
          timestamp: T,
        },
      },
      { type: 'user_answer', content: 'us', timestamp: T },
      { type: 'user_done', timestamp: T },
      {
        type: 'debate_turn',
        turn: {
          speaker: 'claude',
          commentary: 'seed',
          edits: [{ find: '', replace: '# Spec' }],
          applied: [{ find: '', replace: '# Spec' }],
          rejected: [],
          verdict: 'continue',
          charsChanged: 6,
          round: 1,
          timestamp: T,
        },
      },
      {
        type: 'config_update',
        patch: { maxRounds: 16 },
        timestamp: T,
      },
      {
        type: 'done',
        reason: 'mutual_lgtm',
        finalSpec: '# Spec',
        timestamp: T,
      },
    ];
    for (const e of entries) await appendEntry(path, e);
    expect(await readTranscript(path)).toEqual(entries);
  });
});
