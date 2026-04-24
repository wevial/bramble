/**
 * Curated model + reasoning-effort presets for the in-UI model picker.
 *
 * Neither CLI exposes a discoverable model list (no `claude models list`,
 * no `codex models list`), and their public `/v1/models` endpoints require
 * API keys that bramble doesn't carry. Keep this list in sync by hand as
 * new models ship; adding an entry is a one-file change.
 */

export type ModelOption = {
  /** What the user sees in the picker. */
  label: string;
  /**
   * The exact id to pass to `--model`. `null` means "use CLI default"
   * (no flag appended). "custom" is the free-text escape hatch.
   */
  value: string | null | 'custom';
};

export type EffortOption = {
  label: string;
  /** The value passed to --effort / model_reasoning_effort. null = CLI default. */
  value: string | null;
};

export const CLAUDE_MODELS: ModelOption[] = [
  { label: 'default', value: null },
  { label: 'opus 4.7', value: 'claude-opus-4-7' },
  { label: 'sonnet 4.6', value: 'claude-sonnet-4-6' },
  { label: 'haiku 4.5', value: 'claude-haiku-4-5' },
  { label: 'custom…', value: 'custom' },
];

export const CODEX_MODELS: ModelOption[] = [
  { label: 'default', value: null },
  { label: 'gpt-5.4', value: 'gpt-5.4' },
  { label: 'gpt-5.4-mini', value: 'gpt-5.4-mini' },
  { label: 'custom…', value: 'custom' },
];

export const CLAUDE_EFFORTS: EffortOption[] = [
  { label: 'default', value: null },
  { label: 'low', value: 'low' },
  { label: 'medium', value: 'medium' },
  { label: 'high', value: 'high' },
  { label: 'xhigh', value: 'xhigh' },
  { label: 'max', value: 'max' },
];

export const CODEX_EFFORTS: EffortOption[] = [
  { label: 'default', value: null },
  { label: 'low', value: 'low' },
  { label: 'medium', value: 'medium' },
  { label: 'high', value: 'high' },
];

export type ModelConfig = {
  claudeModel: string | null;
  claudeEffort: string | null;
  codexModel: string | null;
  codexEffort: string | null;
};

export function findOptionIndex<T extends { value: string | null | 'custom' }>(
  list: T[],
  value: string | null,
): number {
  // Exact match first; if not found, fall back to "custom" if that option exists.
  const exact = list.findIndex(o => o.value === value);
  if (exact >= 0) return exact;
  const custom = list.findIndex(o => o.value === 'custom');
  return custom >= 0 ? custom : 0;
}
