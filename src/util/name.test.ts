import { describe, it, expect } from 'vitest';
import { generateSessionName } from './name.js';

describe('generateSessionName', () => {
  it('returns a <adjective>-<animal> string', () => {
    const n = generateSessionName();
    expect(n).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it('produces varied output across many calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(generateSessionName());
    // With non-trivial pools we should get plenty of distinct values.
    expect(seen.size).toBeGreaterThan(10);
  });

  it('accepts an injected RNG for determinism', () => {
    // rng returns 0 → first adjective + first animal
    const n = generateSessionName({ rng: () => 0 });
    expect(n).toMatch(/^[a-z]+-[a-z]+$/);
    const n2 = generateSessionName({ rng: () => 0 });
    expect(n).toBe(n2);
  });
});
