import { describe, it, expect } from 'vitest';
import { checkTermination } from './termination.js';

const base = {
  round: 1,
  maxRounds: 8,
  lgtmThisRound: [] as ('claude' | 'codex')[],
  roundVolumes: [0],
  decayThreshold: 50,
  decayWindow: 2,
};

describe('checkTermination', () => {
  it('returns null when no signal has fired', () => {
    expect(checkTermination(base)).toBeNull();
  });

  it('fires mutual_lgtm when both agents lgtm in the same round', () => {
    expect(
      checkTermination({ ...base, lgtmThisRound: ['claude', 'codex'] }),
    ).toBe('mutual_lgtm');
  });

  it('does not fire mutual_lgtm with only one agent', () => {
    expect(checkTermination({ ...base, lgtmThisRound: ['claude'] })).toBeNull();
  });

  it('fires max_rounds when round equals the cap', () => {
    expect(checkTermination({ ...base, round: 8 })).toBe('max_rounds');
  });

  it('does not fire max_rounds before the cap', () => {
    expect(checkTermination({ ...base, round: 7 })).toBeNull();
  });

  it('fires edit_decay when last decayWindow rounds are all under threshold', () => {
    expect(
      checkTermination({
        ...base,
        round: 4,
        roundVolumes: [200, 100, 30, 20],
      }),
    ).toBe('edit_decay');
  });

  it('does not fire edit_decay when only the most recent round is sub-threshold', () => {
    expect(
      checkTermination({
        ...base,
        round: 4,
        roundVolumes: [200, 100, 60, 20],
      }),
    ).toBeNull();
  });

  it('does not fire edit_decay before decayWindow rounds have completed', () => {
    expect(
      checkTermination({
        ...base,
        round: 1,
        roundVolumes: [10],
      }),
    ).toBeNull();
  });

  it('respects custom decayWindow', () => {
    // window=3, all three below threshold → fire.
    expect(
      checkTermination({
        ...base,
        round: 3,
        decayWindow: 3,
        roundVolumes: [10, 20, 30],
      }),
    ).toBe('edit_decay');
    // window=3, only two below → null.
    expect(
      checkTermination({
        ...base,
        round: 3,
        decayWindow: 3,
        roundVolumes: [10, 200, 30],
      }),
    ).toBeNull();
  });

  it('threshold is exclusive: equal volume does not trigger decay', () => {
    expect(
      checkTermination({
        ...base,
        round: 2,
        roundVolumes: [50, 50],
      }),
    ).toBeNull();
  });

  it('mutual_lgtm wins over max_rounds when both fire on the same round', () => {
    expect(
      checkTermination({
        ...base,
        round: 8,
        lgtmThisRound: ['claude', 'codex'],
      }),
    ).toBe('mutual_lgtm');
  });

  it('mutual_lgtm wins over edit_decay when both fire on the same round', () => {
    expect(
      checkTermination({
        ...base,
        round: 4,
        lgtmThisRound: ['claude', 'codex'],
        roundVolumes: [10, 10, 10, 10],
      }),
    ).toBe('mutual_lgtm');
  });

  it('edit_decay wins over max_rounds when both fire on the same round', () => {
    expect(
      checkTermination({
        ...base,
        round: 8,
        roundVolumes: [200, 200, 200, 200, 200, 200, 10, 10],
      }),
    ).toBe('edit_decay');
  });
});
