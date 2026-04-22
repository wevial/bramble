import { describe, it, expect } from 'vitest';
import { nextSpeaker } from './scheduler.js';
import type { State } from './types.js';

const base: State = { speaker: 'idle', transcript: [] };

describe('nextSpeaker (Phase 0: strict alternation)', () => {
  it('opens with claude when transcript is empty', () => {
    expect(nextSpeaker(base)).toBe('claude');
  });

  it('alternates after a claude turn', () => {
    const s: State = {
      ...base,
      transcript: [{ speaker: 'claude', content: 'a', timestamp: 't' }],
    };
    expect(nextSpeaker(s)).toBe('codex');
  });

  it('alternates after a codex turn', () => {
    const s: State = {
      ...base,
      transcript: [
        { speaker: 'claude', content: 'a', timestamp: 't1' },
        { speaker: 'codex', content: 'b', timestamp: 't2' },
      ],
    };
    expect(nextSpeaker(s)).toBe('claude');
  });

  it('ignores user turns when picking the next agent speaker', () => {
    const s: State = {
      ...base,
      transcript: [
        { speaker: 'claude', content: 'a', timestamp: 't1' },
        { speaker: 'user', content: 'wait', timestamp: 't2' },
      ],
    };
    expect(nextSpeaker(s)).toBe('codex');
  });
});
