import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTranscript } from '../docs/transcript.js';
import { rehydrateState } from './replay.js';

let tmp: string;
let path: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bramble-replay-golden-'));
  path = join(tmp, 'transcript.jsonl');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const T = '2026-04-25T00:00:00.000Z';

// A canned end-to-end transcript: session → interview Q&A (one round each
// agent + user_done) → seed edit + agreement turn → done. This is the
// "golden" replay path — if the reducer or replay layer drifts, this test
// pins down what a real session round-trips to.
const FIXTURE = [
  {
    type: 'session',
    prompt: 'design a coin-flip CLI',
    config: { maxRounds: 8, decayThreshold: 50, decayWindow: 2 },
    timestamp: T,
  },
  {
    type: 'interview_turn',
    turn: {
      speaker: 'claude',
      commentary: '',
      question: 'who runs this?',
      ready: false,
      timestamp: T,
    },
  },
  { type: 'user_answer', content: 'me, on a laptop', timestamp: T },
  {
    type: 'interview_turn',
    turn: {
      speaker: 'codex',
      commentary: '',
      question: 'fair coin or biased?',
      ready: false,
      timestamp: T,
    },
  },
  { type: 'user_answer', content: 'fair', timestamp: T },
  { type: 'user_done', timestamp: T },
  {
    type: 'debate_turn',
    turn: {
      speaker: 'claude',
      commentary: 'seed',
      edits: [{ find: '', replace: '# Coin Flip\n\nFair, local CLI.\n' }],
      applied: [{ find: '', replace: '# Coin Flip\n\nFair, local CLI.\n' }],
      rejected: [],
      verdict: 'lgtm',
      charsChanged: 30,
      round: 1,
      timestamp: T,
    },
  },
  {
    type: 'debate_turn',
    turn: {
      speaker: 'codex',
      commentary: 'agree',
      edits: [],
      applied: [],
      rejected: [],
      verdict: 'lgtm',
      charsChanged: 0,
      round: 1,
      timestamp: T,
    },
  },
  // User signs off after both LGTMs.
  { type: 'user_done', timestamp: T },
  {
    type: 'done',
    reason: 'mutual_lgtm',
    finalSpec: '# Coin Flip\n\nFair, local CLI.\n',
    timestamp: T,
  },
];

describe('replay — golden transcript round-trip', () => {
  it('rehydrates a full session via readTranscript + rehydrateState', async () => {
    writeFileSync(
      path,
      FIXTURE.map(e => JSON.stringify(e)).join('\n') + '\n',
      'utf8',
    );
    const entries = await readTranscript(path);
    expect(entries).toHaveLength(FIXTURE.length);

    const state = rehydrateState(entries)!;
    expect(state).not.toBeNull();
    expect(state.phase).toBe('done');
    expect(state.endReason).toBe('mutual_lgtm');
    expect(state.prompt).toBe('design a coin-flip CLI');
    expect(state.spec).toBe('# Coin Flip\n\nFair, local CLI.\n');
    expect(state.interview).toHaveLength(2);
    expect(state.userAnswers).toHaveLength(2);
    expect(state.debate).toHaveLength(2);
    expect(state.config.maxRounds).toBe(8);
  });
});
