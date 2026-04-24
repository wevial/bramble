import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { InputBox } from './InputBox.js';
import { ModelPicker } from './ModelPicker.js';
import {
  CLAUDE_MODELS,
  CODEX_MODELS,
  type ModelConfig,
} from './models.js';
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

function modelLabel(
  list: { label: string; value: string | null | 'custom' }[],
  value: string | null,
): string {
  const found = list.find(o => o.value === value);
  if (found && found.value !== 'custom') return found.label;
  return value ?? 'default';
}

function effortLabel(value: string | null): string {
  return value ?? 'default';
}

function summarizeModels(c: ModelConfig): { claude: string; codex: string } {
  return {
    claude: `${modelLabel(CLAUDE_MODELS, c.claudeModel)} · ${effortLabel(c.claudeEffort)}`,
    codex: `${modelLabel(CODEX_MODELS, c.codexModel)} · ${effortLabel(c.codexEffort)}`,
  };
}

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
  const cardWidth = Math.max(58, Math.min(76, cols - 8));

  const [focus, setFocus] = useState<FieldIndex>(0);
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [mode, setMode] = useState<DebateMode>(initialMode ?? 'auto');
  const [models, setModels] = useState<ModelConfig>(initialModels ?? EMPTY_MODELS);
  const [picking, setPicking] = useState(false);

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
    onSubmit({ prompt: trimmed, mode, models });
  };

  useInput(
    (input, key) => {
      if (key.tab && key.shift) {
        retreat();
        return;
      }
      if (key.tab) {
        advance();
        return;
      }
      // Enter on prompt is handled by the InputBox itself (multiline + submit).
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
      if (focus === 2 && input === ' ') {
        setPicking(true);
        return;
      }
    },
    { isActive: !picking },
  );

  if (picking) {
    return (
      <ModelPicker
        initial={models}
        onSubmit={next => {
          setModels(next);
          setPicking(false);
          setFocus(3);
        }}
        onCancel={() => setPicking(false)}
        onQuit={onQuit}
      />
    );
  }

  const sum = summarizeModels(models);
  const focusColor = (target: FieldIndex): string | undefined =>
    focus === target ? 'green' : undefined;
  const focusMarker = (target: FieldIndex) =>
    focus === target ? '▸ ' : '  ';

  return (
    <Box
      flexDirection="column"
      width={cols}
      alignItems="center"
    >
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
        <Box>
          <Text>   claude: </Text>
          <Text color="cyan">{sum.claude}</Text>
        </Box>
        <Box>
          <Text>   codex:  </Text>
          <Text color="magenta">{sum.codex}</Text>
        </Box>
        {focus === 2 ? (
          <Text dimColor>   space to customize</Text>
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
