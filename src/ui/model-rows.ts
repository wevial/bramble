import {
  CLAUDE_MODELS,
  CODEX_MODELS,
  CLAUDE_EFFORTS,
  CODEX_EFFORTS,
  findOptionIndex,
  type ModelConfig,
  type ModelOption,
  type EffortOption,
} from './models.js';

export type RowKey =
  | 'claudeModel'
  | 'claudeEffort'
  | 'codexModel'
  | 'codexEffort';

export type RowState = {
  key: RowKey;
  label: string;
  options: ModelOption[] | EffortOption[];
  index: number;
  /** Free-text id when the selected option is "custom". */
  custom: string;
};

export const ROW_LABELS: Record<RowKey, string> = {
  claudeModel: 'claude model',
  claudeEffort: 'claude effort',
  codexModel: 'codex model',
  codexEffort: 'codex effort',
};

export function isPresetModel(list: ModelOption[], value: string | null): boolean {
  if (value === null) return true;
  return list.some(o => o.value === value);
}

export function buildRows(initial: ModelConfig): RowState[] {
  return [
    {
      key: 'claudeModel',
      label: ROW_LABELS.claudeModel,
      options: CLAUDE_MODELS,
      index: findOptionIndex(CLAUDE_MODELS, initial.claudeModel),
      custom: isPresetModel(CLAUDE_MODELS, initial.claudeModel)
        ? ''
        : initial.claudeModel ?? '',
    },
    {
      key: 'claudeEffort',
      label: ROW_LABELS.claudeEffort,
      options: CLAUDE_EFFORTS,
      index: findOptionIndex(CLAUDE_EFFORTS, initial.claudeEffort),
      custom: '',
    },
    {
      key: 'codexModel',
      label: ROW_LABELS.codexModel,
      options: CODEX_MODELS,
      index: findOptionIndex(CODEX_MODELS, initial.codexModel),
      custom: isPresetModel(CODEX_MODELS, initial.codexModel)
        ? ''
        : initial.codexModel ?? '',
    },
    {
      key: 'codexEffort',
      label: ROW_LABELS.codexEffort,
      options: CODEX_EFFORTS,
      index: findOptionIndex(CODEX_EFFORTS, initial.codexEffort),
      custom: '',
    },
  ];
}

export function resolveRows(rows: RowState[]): ModelConfig {
  const resolve = (row: RowState): string | null => {
    const opt = row.options[row.index];
    if (!opt) return null;
    if (opt.value === 'custom') {
      const trimmed = row.custom.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return opt.value;
  };
  return {
    claudeModel: resolve(rows[0]!),
    claudeEffort: resolve(rows[1]!),
    codexModel: resolve(rows[2]!),
    codexEffort: resolve(rows[3]!),
  };
}
