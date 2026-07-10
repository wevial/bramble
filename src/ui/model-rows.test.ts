import { describe, it, expect } from 'bun:test';
import { buildRows, resolveRows } from './model-rows.js';

describe('buildRows / resolveRows', () => {
  it('round-trips preset ids', () => {
    const config = {
      claudeModel: 'claude-fable-5',
      claudeEffort: 'high',
      codexModel: 'gpt-5.6-sol',
      codexEffort: 'medium',
    };
    expect(resolveRows(buildRows(config))).toEqual(config);
  });

  it('preserves ids that are no longer presets via the custom row', () => {
    // A setup file saved before a preset was retired (e.g. gpt-5.4-mini,
    // claude-sonnet-4-6) must survive load → submit unchanged: the picker
    // shows it as "custom…" with the id as the custom text.
    const config = {
      claudeModel: 'claude-sonnet-4-6',
      claudeEffort: null,
      codexModel: 'gpt-5.4-mini',
      codexEffort: null,
    };
    const rows = buildRows(config);
    expect(rows[0]!.options[rows[0]!.index]!.value).toBe('custom');
    expect(rows[0]!.custom).toBe('claude-sonnet-4-6');
    expect(rows[2]!.options[rows[2]!.index]!.value).toBe('custom');
    expect(rows[2]!.custom).toBe('gpt-5.4-mini');
    expect(resolveRows(rows)).toEqual(config);
  });

  it('keeps the custom text when the row index cycles away and back', () => {
    const rows = buildRows({
      claudeModel: null,
      claudeEffort: null,
      codexModel: 'gpt-5.4-mini',
      codexEffort: null,
    });
    const codex = rows[2]!;
    const customIndex = codex.index;
    // Cycling only moves `index`; the custom text is separate row state, so
    // wandering off the custom option and returning restores the old id.
    const cycled = { ...codex, index: 0 };
    const back = { ...cycled, index: customIndex };
    expect(back.custom).toBe('gpt-5.4-mini');
    expect(resolveRows([rows[0]!, rows[1]!, back, rows[3]!]).codexModel).toBe(
      'gpt-5.4-mini',
    );
  });
});
