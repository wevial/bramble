import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
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
import { InputBox } from './InputBox.js';

export type ModelPickerProps = {
  initial: ModelConfig;
  onSubmit(config: ModelConfig): void;
  onCancel(): void;
  onQuit(): void;
};

type RowKey = 'claudeModel' | 'claudeEffort' | 'codexModel' | 'codexEffort';

type RowState = {
  key: RowKey;
  label: string;
  options: ModelOption[] | EffortOption[];
  index: number;
  custom: string; // free text for "custom…" model ids
};

const ROW_LABELS: Record<RowKey, string> = {
  claudeModel: 'claude model',
  claudeEffort: 'claude effort',
  codexModel: 'codex model',
  codexEffort: 'codex effort',
};

function buildRows(initial: ModelConfig): RowState[] {
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

function isPresetModel(list: ModelOption[], value: string | null): boolean {
  if (value === null) return true;
  return list.some(o => o.value === value);
}

export function resolveConfig(rows: RowState[]): ModelConfig {
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

export function ModelPicker({
  initial,
  onSubmit,
  onCancel,
  onQuit,
}: ModelPickerProps) {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const rowsH = stdout?.rows ?? 24;
  const cardWidth = Math.max(60, Math.min(84, cols - 8));

  const [rows, setRows] = useState<RowState[]>(() => buildRows(initial));
  const [focus, setFocus] = useState(0);
  const [editingCustom, setEditingCustom] = useState(false);

  const focusedRow = rows[focus]!;
  const focusedOpt = focusedRow.options[focusedRow.index]!;
  const needsCustomText = focusedOpt.value === 'custom';

  useInput((input, key) => {
    if (editingCustom) return; // InputBox takes over
    if (key.ctrl && (input === 'c' || input === 'd')) {
      onQuit();
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow || (key.shift && key.tab)) {
      setFocus(f => (f - 1 + rows.length) % rows.length);
      return;
    }
    if (key.downArrow || key.tab) {
      setFocus(f => (f + 1) % rows.length);
      return;
    }
    if (key.leftArrow) {
      setRows(rs =>
        rs.map((r, i) =>
          i === focus
            ? { ...r, index: (r.index - 1 + r.options.length) % r.options.length }
            : r,
        ),
      );
      return;
    }
    if (key.rightArrow) {
      setRows(rs =>
        rs.map((r, i) =>
          i === focus
            ? { ...r, index: (r.index + 1) % r.options.length }
            : r,
        ),
      );
      return;
    }
    if (input === 'e' && needsCustomText) {
      setEditingCustom(true);
      return;
    }
    if (key.return) {
      onSubmit(resolveConfig(rows));
    }
  });

  return (
    <Box
      flexDirection="column"
      width={cols}
      height={rowsH}
      justifyContent="center"
      alignItems="center"
    >
      <Box
        flexDirection="column"
        borderStyle="round"
        paddingX={3}
        paddingY={1}
        width={cardWidth}
      >
        <Box justifyContent="center">
          <Text bold color="green">
            pick models
          </Text>
        </Box>
        <Text> </Text>
        <Text dimColor>
          ↑↓/Tab: row · ←→: option · e: edit custom id · Enter: start · Esc: back
        </Text>
        <Text> </Text>
        {rows.map((row, i) => (
          <PickerRow key={row.key} row={row} focused={i === focus} />
        ))}
        {needsCustomText && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>
              custom {focusedRow.label.includes('claude') ? 'claude' : 'codex'}{' '}
              model id{editingCustom ? ' (enter to confirm)' : " (press 'e' to edit)"}:
            </Text>
            {editingCustom ? (
              <Box borderStyle="single" paddingX={1}>
                <InputBox
                  allowEmptySubmit
                  onSubmit={line => {
                    setRows(rs =>
                      rs.map((r, i) =>
                        i === focus ? { ...r, custom: line } : r,
                      ),
                    );
                    setEditingCustom(false);
                  }}
                  onQuit={onQuit}
                />
              </Box>
            ) : (
              <Text color={focusedRow.custom ? 'white' : 'gray'}>
                {focusedRow.custom || '(none — use default)'}
              </Text>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}

function PickerRow({ row, focused }: { row: RowState; focused: boolean }) {
  return (
    <Box>
      <Box width={15}>
        <Text color={focused ? 'cyanBright' : undefined}>
          {focused ? '› ' : '  '}
          {row.label}
        </Text>
      </Box>
      <Box>
        {row.options.map((opt, i) => {
          const selected = i === row.index;
          const display =
            opt.value === 'custom' && selected && (row as RowState).custom
              ? `custom: ${(row as RowState).custom}`
              : opt.label;
          return (
            <Text key={opt.label}>
              {i === 0 ? '' : '  '}
              {selected ? (
                <Text
                  color={focused ? 'cyanBright' : 'white'}
                  bold={focused}
                  underline={focused}
                >
                  {display}
                </Text>
              ) : (
                <Text dimColor>{display}</Text>
              )}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
