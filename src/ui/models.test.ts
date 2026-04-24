import { describe, it, expect } from 'vitest';
import {
  CLAUDE_MODELS,
  CODEX_MODELS,
  CLAUDE_EFFORTS,
  CODEX_EFFORTS,
  findOptionIndex,
} from './models.js';

describe('model presets', () => {
  it('each list starts with "default" and includes a custom model option', () => {
    for (const list of [CLAUDE_MODELS, CODEX_MODELS]) {
      expect(list[0]?.label).toBe('default');
      expect(list[0]?.value).toBeNull();
      expect(list.some(o => o.value === 'custom')).toBe(true);
    }
  });

  it('effort lists start with default and do not have a custom row', () => {
    for (const list of [CLAUDE_EFFORTS, CODEX_EFFORTS]) {
      expect(list[0]?.label).toBe('default');
      expect(list[0]?.value).toBeNull();
      expect(list.every(o => o.value !== 'custom')).toBe(true);
    }
  });

  it('claude has the xhigh+max tiers that codex does not', () => {
    const claudeVals = CLAUDE_EFFORTS.map(e => e.value);
    const codexVals = CODEX_EFFORTS.map(e => e.value);
    expect(claudeVals).toContain('xhigh');
    expect(claudeVals).toContain('max');
    expect(codexVals).not.toContain('xhigh');
    expect(codexVals).not.toContain('max');
  });
});

describe('findOptionIndex', () => {
  it('returns the exact-match index', () => {
    expect(findOptionIndex(CLAUDE_MODELS, 'claude-sonnet-4-6')).toBe(
      CLAUDE_MODELS.findIndex(o => o.value === 'claude-sonnet-4-6'),
    );
  });

  it('falls back to "custom…" when the id is not in presets', () => {
    const idx = findOptionIndex(CLAUDE_MODELS, 'claude-future-model-999');
    expect(CLAUDE_MODELS[idx]?.value).toBe('custom');
  });

  it('maps null to the default row', () => {
    expect(findOptionIndex(CLAUDE_MODELS, null)).toBe(0);
  });
});
