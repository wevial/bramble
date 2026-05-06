import React, { useState } from 'react';
import { createTextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
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

const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });
const REVERSE = createTextAttributes({ inverse: true });
const BOLD_REVERSE = createTextAttributes({ bold: true, inverse: true });
const BOLD_UNDERLINE = createTextAttributes({ bold: true, underline: true });

export function SetupScreen({
  sessionName,
  initialPrompt,
  initialMode,
  initialModels,
  onSubmit,
  onQuit,
}: SetupScreenProps) {
  const { width } = useTerminalDimensions();
  const cols = width ?? 80;
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

  useKeyboard(
    key => {
      if (editingCustom) return; // InputBox owns the keyboard
      if (key.name === 'tab' && key.shift) {
        retreat();
        return;
      }
      if (key.name === 'tab') {
        advance();
        return;
      }
      // Enter on prompt is handled inside the multiline InputBox.
      if ((key.name === 'return' || key.name === 'enter') && focus !== 0) {
        if (focus === 3) {
          tryStart();
        } else {
          advance();
        }
        return;
      }
      if (focus === 1) {
        if (key.name === 'left' || key.name === 'right') {
          setMode(m => (m === 'auto' ? 'collab' : 'auto'));
        }
        return;
      }
      if (focus === 2) {
        if (key.name === 'up') {
          setModelRowFocus(i => (i - 1 + rows.length) % rows.length);
          return;
        }
        if (key.name === 'down') {
          setModelRowFocus(i => (i + 1) % rows.length);
          return;
        }
        if (key.name === 'left') {
          setRows(rs =>
            rs.map((r, i) =>
              i === modelRowFocus
                ? { ...r, index: (r.index - 1 + r.options.length) % r.options.length }
                : r,
            ),
          );
          return;
        }
        if (key.name === 'right') {
          setRows(rs =>
            rs.map((r, i) =>
              i === modelRowFocus
                ? { ...r, index: (r.index + 1) % r.options.length }
                : r,
            ),
          );
          return;
        }
        if (key.name === 'e' && needsCustomText) {
          setEditingCustom(true);
          return;
        }
        return;
      }
    },
  );

  const focusColor = (target: FieldIndex): string | undefined =>
    focus === target ? 'green' : undefined;
  const focusMarker = (target: FieldIndex) =>
    focus === target ? '▸ ' : '  ';

  return (
    <box flexDirection="column" width={cols} alignItems="center">
      <box
        flexDirection="column"
        border borderStyle="rounded"
        paddingX={3}
        paddingY={1}
        width={cardWidth}
      >
        {BRAMBLE_BANNER.map((line, i) => (
          <box key={i} justifyContent="center">
            <text fg="green">{line}</text>
          </box>
        ))}
        <text> </text>
        <box justifyContent="center">
          <text>session: {sessionName}</text>
        </box>
        <text> </text>
        <text>Two agents will debate and draft a spec together.</text>
        <text> </text>

        <box>
          <text fg={focusColor(0)} attributes={(focus === 0) ? BOLD : 0}>
            {focusMarker(0)}What do you want to design?
          </text>
        </box>
        <text><span attributes={DIM}>  e.g. "design tic-tac-toe" — shift+enter for newline</span></text>
        <box border borderStyle="single" paddingX={1}>
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
        </box>
        <text> </text>

        <box>
          <text fg={focusColor(1)} attributes={(focus === 1) ? BOLD : 0}>
            {focusMarker(1)}Mode
          </text>
        </box>
        <box flexDirection="row">
          <text>
            <span>   </span>
            <ModeOption label="auto" selected={mode === 'auto'} focused={focus === 1} />
            <span>  </span>
            <ModeOption label="collab" selected={mode === 'collab'} focused={focus === 1} />
          </text>
          {focus === 1 ? (
            <text><span attributes={DIM}>    ←/→ to switch</span></text>
          ) : null}
        </box>
        <text> </text>

        <box>
          <text fg={focusColor(2)} attributes={(focus === 2) ? BOLD : 0}>
            {focusMarker(2)}Models
          </text>
        </box>
        {focus === 2 ? (
          <text><span attributes={DIM}>   ↑↓ row · ←→ option{needsCustomText ? " · 'e' edit custom id" : ''}</span></text>
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
          <box flexDirection="column" marginTop={1}>
            <text><span attributes={DIM}>
              {`   custom ${focusedRow.key.startsWith('claude') ? 'claude' : 'codex'} model id${
                editingCustom ? ' (enter to confirm)' : " (press 'e' to edit)"
              }:`}
            </span></text>
            {editingCustom ? (
              <box marginLeft={3} border borderStyle="single" paddingX={1}>
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
              </box>
            ) : (
              <text fg={focusedRow.custom ? 'white' : 'gray'}>
                {`   ${focusedRow.custom || '(none — use default)'}`}
              </text>
            )}
          </box>
        ) : null}
        <text> </text>

        <box justifyContent="center">
          <text
            fg={focus === 3 ? 'brightGreen' : undefined}
            attributes={focus === 3 ? BOLD_REVERSE : 0}
          >
            {'  Start  '}
          </text>
        </box>
        <text> </text>
        <box justifyContent="center">
          <text><span attributes={DIM}>
            tab/enter forward · shift-tab back · /quit to exit
          </span></text>
        </box>
      </box>
    </box>
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
      <span fg={focused ? 'brightGreen' : 'green'} attributes={BOLD}>
        [● {label}]
      </span>
    );
  }
  return <span attributes={DIM}>[  {label}]</span>;
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
    <box flexDirection="row">
      <box width={22}>
        <text fg={rowFocused ? 'brightCyan' : undefined}>
          {rowFocused ? '   › ' : '     '}
          {row.label}
        </text>
      </box>
      <box flexGrow={1}>
        <text>
        {row.options.map((opt, i) => {
          const selected = i === row.index;
          const display =
            opt.value === 'custom' && selected && row.custom
              ? `custom: ${row.custom}`
              : opt.label;
          return (
            <span key={opt.label}>
              {i === 0 ? '' : '  '}
              {selected ? (
                <span
                  fg={rowFocused ? 'brightCyan' : sectionFocused ? 'white' : undefined}
                  attributes={rowFocused ? BOLD_UNDERLINE : 0}
                >
                  {display}
                </span>
              ) : (
                <span attributes={DIM}>{display}</span>
              )}
            </span>
          );
        })}
        </text>
      </box>
    </box>
  );
}
