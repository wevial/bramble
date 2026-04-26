import { describe, it, expect } from 'vitest';
import { rehydrateState } from './replay.js';
import type { TranscriptEntry } from '../docs/transcript.js';

const T = '2026-04-25T00:00:00.000Z';

const SESSION: TranscriptEntry = {
  type: 'session',
  prompt: 'design auth',
  config: { maxRounds: 8, decayThreshold: 50, decayWindow: 2 },
  timestamp: T,
};

describe('rehydrateState', () => {
  it('returns null on an empty transcript', () => {
    expect(rehydrateState([])).toBeNull();
  });

  it('returns null when the first entry is not a session', () => {
    expect(
      rehydrateState([
        {
          type: 'interview_turn',
          turn: {
            speaker: 'claude',
            commentary: '',
            question: 'q',
            ready: false,
            timestamp: T,
          },
        },
      ]),
    ).toBeNull();
  });

  it('rebuilds initial state from a session entry alone', () => {
    const s = rehydrateState([SESSION])!;
    expect(s.phase).toBe('interview');
    expect(s.prompt).toBe('design auth');
    expect(s.config.maxRounds).toBe(8);
    expect(s.interview).toEqual([]);
    expect(s.debate).toEqual([]);
    expect(s.spec).toBe('');
  });

  it('rebuilds the interview phase Q&A', () => {
    const s = rehydrateState([
      SESSION,
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
    ])!;
    expect(s.phase).toBe('interview');
    expect(s.interview).toHaveLength(1);
    expect(s.interview[0]!.question).toBe('who?');
    expect(s.userAnswers).toHaveLength(1);
  });

  it('user_done flips the phase to debate during replay', () => {
    const s = rehydrateState([SESSION, { type: 'user_done', timestamp: T }])!;
    expect(s.phase).toBe('debate');
  });

  it('rebuilds spec body and termination state from a full debate', () => {
    const s = rehydrateState([
      SESSION,
      { type: 'user_done', timestamp: T },
      {
        type: 'debate_turn',
        turn: {
          speaker: 'claude',
          commentary: 'seed',
          edits: [{ find: '', replace: '# Spec\n' }],
          applied: [],
          rejected: [],
          verdict: 'lgtm',
          charsChanged: 0,
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
    ])!;
    expect(s.phase).toBe('done');
    expect(s.endReason).toBe('mutual_lgtm');
    expect(s.spec).toBe('# Spec\n');
  });

  it('config_update entries take effect during replay', () => {
    const s = rehydrateState([
      SESSION,
      {
        type: 'config_update',
        patch: { maxRounds: 16 },
        timestamp: T,
      },
    ])!;
    expect(s.config.maxRounds).toBe(16);
  });
});
