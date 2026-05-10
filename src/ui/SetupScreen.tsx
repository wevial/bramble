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
import {
  SPECIALIST_PERSONAS,
  type PersonaId,
} from '../personas/personas.js';

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
  specialists: PersonaId[];
  moderator: boolean;
};

export type SetupScreenProps = {
  sessionName: string;
  initialPrompt?: string;
  initialMode?: DebateMode;
  initialModels?: ModelConfig;
  initialSpecialists?: PersonaId[];
  initialModerator?: boolean;
  onSubmit(result: SetupSubmit): void;
  onQuit(): void;
};

type FieldIndex = 0 | 1 | 2 | 3 | 4 | 5; // prompt, mode, models, specialists, moderator, start

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
  initialSpecialists,
  initialModerator,
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
  const [specialists, setSpecialists] = useState<Set<PersonaId>>(
    () => new Set(initialSpecialists ?? []),
  );
  const [specialistRowFocus, setSpecialistRowFocus] = useState(0);
  const [moderator, setModerator] = useState<boolean>(initialModerator ?? false);

  const advance = () =>
    setFocus(f => (f < 5 ? ((f + 1) as FieldIndex) : f));
  const retreat = () =>
    setFocus(f => (f > 0 ? ((f - 1) as FieldIndex) : f));

  const tryStart = () => {
    const trimmed = prompt.trim();
    if (trimmed.length === 0) {
      setFocus(0);
      return;
    }
    onSubmit({
      prompt: trimmed,
      mode,
      models: resolveRows(rows),
      specialists: SPECIALIST_PERSONAS.filter(p => specialists.has(p.id)).map(
        p => p.id,
      ),
      moderator,
    });
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
        if (focus === 5) {
          tryStart();
        } else {
          // Enter on specialists (3) and moderator (4) advances; toggling
          // is space-only there.
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
      if (focus === 4) {
        if (
          key.name === 'left' ||
          key.name === 'right' ||
          key.name === 'space'
        ) {
          setModerator(m => !m);
        }
        return;
      }
      if (focus === 3) {
        if (key.name === 'up') {
          setSpecialistRowFocus(
            i => (i - 1 + SPECIALIST_PERSONAS.length) % SPECIALIST_PERSONAS.length,
          );
          return;
        }
        if (key.name === 'down') {
          setSpecialistRowFocus(i => (i + 1) % SPECIALIST_PERSONAS.length);
          return;
        }
        if (key.name === 'space') {
          const persona = SPECIALIST_PERSONAS[specialistRowFocus];
          if (persona) {
            setSpecialists(prev => {
              const next = new Set(prev);
              if (next.has(persona.id)) next.delete(persona.id);
              else next.add(persona.id);
              return next;
            });
          }
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

        <box>
          <text fg={focusColor(3)} attributes={(focus === 3) ? BOLD : 0}>
            {focusMarker(3)}Specialists (optional)
          </text>
        </box>
        <text><span attributes={DIM}>   add critic personas to the debate — each takes a turn every round</span></text>
        {focus === 3 ? (
          <text><span attributes={DIM}>   ↑↓ row · space toggle · enter advances</span></text>
        ) : null}
        {SPECIALIST_PERSONAS.map((persona, i) => {
          const enabled = specialists.has(persona.id);
          const rowFocused = focus === 3 && specialistRowFocus === i;
          return (
            <box key={persona.id} flexDirection="row">
              <text fg={rowFocused ? 'brightCyan' : undefined}>
                {rowFocused ? '   › ' : '     '}
                <span fg={enabled ? 'green' : undefined}>
                  {enabled ? '[x] ' : '[ ] '}
                </span>
                <span fg={persona.color}>{persona.glyph} </span>
                <span attributes={enabled ? BOLD : 0}>{persona.label}</span>
                <span attributes={DIM}>
                  {' '}· via {persona.transport}
                </span>
              </text>
            </box>
          );
        })}
        <text> </text>

        <box>
          <text fg={focusColor(4)} attributes={(focus === 4) ? BOLD : 0}>
            {focusMarker(4)}Moderator (optional)
          </text>
        </box>
        <text><span attributes={DIM}>   when on, an LLM picks the next speaker each turn (uses gpt-5.4-mini)</span></text>
        <box flexDirection="row">
          <text>
            <span>   </span>
            <ModeratorOption label="off" selected={!moderator} focused={focus === 4} />
            <span>  </span>
            <ModeratorOption label="on" selected={moderator} focused={focus === 4} />
          </text>
          {focus === 4 ? (
            <text><span attributes={DIM}>    ←/→ or space toggles · enter advances</span></text>
          ) : null}
        </box>
        <text> </text>

        <box justifyContent="center">
          <text
            fg={focus === 5 ? 'brightGreen' : undefined}
            attributes={focus === 5 ? BOLD_REVERSE : 0}
          >
            {'  Start  '}
          </text>
        </box>
        <text> </text>
        <box justifyContent="center">
          <text><span attributes={DIM}>
            tab/enter forward · shift-tab back · ctrl+c to exit
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

function ModeratorOption({
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
