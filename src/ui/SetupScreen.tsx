import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { InputBox } from './InputBox.js';
import { type ModelConfig } from './models.js';
import {
  buildRows,
  resolveRows,
  type RowState,
} from './model-rows.js';
import type { DebateMode } from '../orchestrator/runner.js';

const BRAMBLE_BANNER = [
  '    ▄▄▄                            ▄▄       ',
  '   ██▀▀█▄                     █▄    ██      ',
  '   ██ ▄█▀ ▄          ▄        ██    ██      ',
  '   ██▀▀█▄ ████▄▄▀▀█▄ ███▄███▄ ████▄ ██ ▄█▀█▄',
  ' ▄ ██  ▄█ ██   ▄█▀██ ██ ██ ██ ██ ██ ██ ██▄█▀',
  ' ▀██████▀▄█▀  ▄▀█▄██▄██ ██ ▀█▄████▀▄██▄▀█▄▄▄',
];

export type SetupSubmit = {
  prompt: string;
  mode: DebateMode;
  models: ModelConfig;
};

export type SetupScreenProps = {
  sessionName: string;
  initialPrompt?: string;
  initialMode?: DebateMode;
  initialModels?: ModelConfig;
  onSubmit(result: SetupSubmit): void;
  onQuit(): void;
};

type FieldIndex = 0 | 1 | 2 | 3; // prompt, mode, models, start

const EMPTY_MODELS: ModelConfig = {
  claudeModel: null,
  claudeEffort: null,
  codexModel: null,
  codexEffort: null,
};

export function SetupScreen({
  sessionName,
  initialPrompt,
  initialMode,
  initialModels,
  onSubmit,
  onQuit,
}: SetupScreenProps) {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const cardWidth = Math.max(64, Math.min(86, cols - 8));

  const [focus, setFocus] = useState<FieldIndex>(0);
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [mode, setMode] = useState<DebateMode>(initialMode ?? 'auto');
  const [rows, setRows] = useState<RowState[]>(() =>
    buildRows(initialModels ?? EMPTY_MODELS),
  );
  const [modelRowFocus, setModelRowFocus] = useState(0);
  const [editingCustom, setEditingCustom] = useState(false);

  const advance = () =>
    setFocus(f => (f < 3 ? ((f + 1) as FieldIndex) : f));
  const retreat = () =>
    setFocus(f => (f > 0 ? ((f - 1) as FieldIndex) : f));

  const tryStart = () => {
    const trimmed = prompt.trim();
    if (trimmed.length === 0) {
      setFocus(0);
      return;
    }
    onSubmit({ prompt: trimmed, mode, models: resolveRows(rows) });
  };

  const focusedRow = rows[modelRowFocus]!;
  const focusedOpt = focusedRow.options[focusedRow.index]!;
  const needsCustomText = focusedOpt.value === 'custom';

  useInput(
    (input, key) => {
      if (editingCustom) return; // InputBox owns the keyboard
      if (key.tab && key.shift) {
        retreat();
        return;
      }
      if (key.tab) {
        advance();
        return;
      }
      // Enter on prompt is handled inside the multiline InputBox.
      if (key.return && focus !== 0) {
        if (focus === 3) {
          tryStart();
        } else {
          advance();
        }
        return;
      }
      if (focus === 1) {
        if (key.leftArrow || key.rightArrow) {
          setMode(m => (m === 'auto' ? 'collab' : 'auto'));
        }
        return;
      }
      if (focus === 2) {
        if (key.upArrow) {
          setModelRowFocus(i => (i - 1 + rows.length) % rows.length);
          return;
        }
        if (key.downArrow) {
          setModelRowFocus(i => (i + 1) % rows.length);
          return;
        }
        if (key.leftArrow) {
          setRows(rs =>
            rs.map((r, i) =>
              i === modelRowFocus
                ? { ...r, index: (r.index - 1 + r.options.length) % r.options.length }
                : r,
            ),
          );
          return;
        }
        if (key.rightArrow) {
          setRows(rs =>
            rs.map((r, i) =>
              i === modelRowFocus
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
        return;
      }
    },
    { isActive: true },
  );

  const focusColor = (target: FieldIndex): string | undefined =>
    focus === target ? 'green' : undefined;
  const focusMarker = (target: FieldIndex) =>
    focus === target ? '▸ ' : '  ';

  return (
    <Box flexDirection="column" width={cols} alignItems="center">
      <Box
        flexDirection="column"
        borderStyle="round"
        paddingX={3}
        paddingY={1}
        width={cardWidth}
      >
        {BRAMBLE_BANNER.map((line, i) => (
          <Box key={i} justifyContent="center">
            <Text color="green">{line}</Text>
          </Box>
        ))}
        <Text> </Text>
        <Box justifyContent="center">
          <Text dimColor>session: {sessionName}</Text>
        </Box>
        <Text> </Text>
        <Text>Two agents will debate and draft a spec together.</Text>
        <Text> </Text>

        <Box>
          <Text color={focusColor(0)} bold={focus === 0}>
            {focusMarker(0)}What do you want to design?
          </Text>
        </Box>
        <Text dimColor>  e.g. "design tic-tac-toe" — shift+enter for newline</Text>
        <Box borderStyle="single" paddingX={1}>
          <InputBox
            initialValue={initialPrompt}
            multiline
            isActive={focus === 0}
            onChange={setPrompt}
            onSubmit={value => {
              setPrompt(value);
              advance();
            }}
            onQuit={onQuit}
            allowEmptySubmit
          />
        </Box>
        <Text> </Text>

        <Box>
          <Text color={focusColor(1)} bold={focus === 1}>
            {focusMarker(1)}Mode
          </Text>
        </Box>
        <Box>
          <Text>   </Text>
          <ModeOption label="auto" selected={mode === 'auto'} focused={focus === 1} />
          <Text>  </Text>
          <ModeOption label="collab" selected={mode === 'collab'} focused={focus === 1} />
          {focus === 1 ? (
            <Text dimColor>    ←/→ to switch</Text>
          ) : null}
        </Box>
        <Text> </Text>

        <Box>
          <Text color={focusColor(2)} bold={focus === 2}>
            {focusMarker(2)}Models
          </Text>
        </Box>
        {focus === 2 ? (
          <Text dimColor>   ↑↓ row · ←→ option{needsCustomText ? " · 'e' edit custom id" : ''}</Text>
        ) : null}
        {rows.map((row, i) => (
          <ModelRow
            key={row.key}
            row={row}
            sectionFocused={focus === 2}
            rowFocused={focus === 2 && modelRowFocus === i}
          />
        ))}
        {focus === 2 && needsCustomText ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>
              {`   custom ${focusedRow.key.startsWith('claude') ? 'claude' : 'codex'} model id${
                editingCustom ? ' (enter to confirm)' : " (press 'e' to edit)"
              }:`}
            </Text>
            {editingCustom ? (
              <Box marginLeft={3} borderStyle="single" paddingX={1}>
                <InputBox
                  allowEmptySubmit
                  initialValue={focusedRow.custom}
                  onSubmit={line => {
                    setRows(rs =>
                      rs.map((r, i) =>
                        i === modelRowFocus ? { ...r, custom: line } : r,
                      ),
                    );
                    setEditingCustom(false);
                  }}
                  onQuit={onQuit}
                />
              </Box>
            ) : (
              <Text color={focusedRow.custom ? 'white' : 'gray'}>
                {`   ${focusedRow.custom || '(none — use default)'}`}
              </Text>
            )}
          </Box>
        ) : null}
        <Text> </Text>

        <Box justifyContent="center">
          <Text
            color={focus === 3 ? 'greenBright' : undefined}
            bold={focus === 3}
            inverse={focus === 3}
          >
            {'  Start  '}
          </Text>
        </Box>
        <Text> </Text>
        <Box justifyContent="center">
          <Text dimColor>
            tab/enter forward · shift-tab back · /quit to exit
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function ModeOption({
  label,
  selected,
  focused,
}: {
  label: string;
  selected: boolean;
  focused: boolean;
}) {
  if (selected) {
    return (
      <Text color={focused ? 'greenBright' : 'green'} bold>
        [● {label}]
      </Text>
    );
  }
  return <Text dimColor>[  {label}]</Text>;
}

function ModelRow({
  row,
  sectionFocused,
  rowFocused,
}: {
  row: RowState;
  sectionFocused: boolean;
  rowFocused: boolean;
}) {
  return (
    <Box>
      <Box width={22}>
        <Text color={rowFocused ? 'cyanBright' : undefined}>
          {rowFocused ? '   › ' : '     '}
          {row.label}
        </Text>
      </Box>
      <Box>
        {row.options.map((opt, i) => {
          const selected = i === row.index;
          const display =
            opt.value === 'custom' && selected && row.custom
              ? `custom: ${row.custom}`
              : opt.label;
          return (
            <Text key={opt.label}>
              {i === 0 ? '' : '  '}
              {selected ? (
                <Text
                  color={rowFocused ? 'cyanBright' : sectionFocused ? 'white' : undefined}
                  bold={rowFocused}
                  underline={rowFocused}
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
