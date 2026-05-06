import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput, useStdin, useStdout } from 'ink';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Agent } from '../agents/agent.js';
import {
  startDebate,
  type RunHandle,
  type DebateMode,
} from '../orchestrator/runner.js';
import { writeSpec } from '../docs/spec.js';
import { writeInterviewMd } from '../docs/interview.js';
import { writeDebateLedger } from '../docs/debate.js';
import { type State, type DebateConfig } from '../orchestrator/state.js';
import { InputBox } from './InputBox.js';
import { parseSlashCommand } from './commands.js';
import type { ModelConfig } from './models.js';
import { SetupScreen } from './SetupScreen.js';
import { saveSetup } from './setup-store.js';
import { FlowBox, ParticipantsBox } from './FlowSidebar.js';
import { ConversationPane } from './ConversationPane.js';
import { SpecPane, type SaveStatus, type SpecMode } from './SpecPane.js';
import { StatusStrip } from './StatusStrip.js';

export type AppProps = {
  agents: { claude: Agent; codex: Agent };
  prompt?: string;
  sessionName: string;
  config?: Partial<DebateConfig>;
  mode?: DebateMode;
  initialState?: State;
  promptSidecarPath?: string;
  transcriptPath: string;
  specPath: string;
  debatePath: string;
  interviewPath: string;
  onDone?: () => void;
  onQuit?: () => void;
  skipPromptEntry?: boolean;
  buildAgents?: (config: ModelConfig) => { claude: Agent; codex: Agent };
  initialModelConfig?: ModelConfig;
  setupStorePath?: string;
};

export function App(props: AppProps) {
  const initialPrompt = (props.prompt ?? '').trim();
  const isResume =
    (props.initialState?.interview.length ?? 0) > 0 ||
    (props.initialState?.debate.length ?? 0) > 0;
  const showSetup = !isResume && !props.skipPromptEntry;
  const [phase, setUiPhase] = useState<'setup' | 'running'>(
    showSetup ? 'setup' : 'running',
  );
  const [activeAgents, setActiveAgents] = useState(props.agents);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [state, setState] = useState<State | null>(props.initialState ?? null);
  const [status, setStatus] = useState('starting…');
  const [paused, setPaused] = useState(false);
  const [mode, setMode] = useState<DebateMode>(props.mode ?? 'auto');
  const handleRef = useRef<RunHandle | null>(null);
  const writesRef = useRef<Promise<void>>(Promise.resolve());
  const { stdout } = useStdout();
  const stdinCtx = useStdin();
  const [editorBusy, setEditorBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dims, setDims] = useState({
    rows: stdout?.rows ?? 24,
    columns: stdout?.columns ?? 80,
  });

  useEffect(() => {
    if (!stdout) return;
    const onResize = () =>
      setDims({ rows: stdout.rows, columns: stdout.columns });
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  useEffect(() => {
    if (phase !== 'running' || !prompt) return;
    if (props.promptSidecarPath) {
      import('node:fs/promises')
        .then(fs => fs.writeFile(props.promptSidecarPath!, prompt, 'utf8'))
        .catch(() => {});
    }
    const handle = startDebate({
      agents: activeAgents,
      prompt,
      config: props.config,
      mode,
      transcriptPath: props.transcriptPath,
      initialState: props.initialState,
      onPauseChange: setPaused,
      onState: next => {
        setState(next);
        // Chain rewrites through the prior promise so two state updates can't
        // race and leave a stale older write as the final on-disk content.
        // Snapshot the values now so the writer always uses this state's view.
        const spec = next.spec;
        const interview = next.interview;
        const answers = next.userAnswers;
        const debate = next.debate;
        setSaveStatus('saving');
        if (savedTimerRef.current) {
          clearTimeout(savedTimerRef.current);
          savedTimerRef.current = null;
        }
        writesRef.current = writesRef.current
          .then(() => writeSpec(props.specPath, spec))
          .then(() => writeInterviewMd(props.interviewPath, interview, answers))
          .then(() => writeDebateLedger(props.debatePath, debate))
          .then(() => {
            setSaveStatus('saved');
            // Auto-fade the "Saved" indicator back to idle so the corner
            // doesn't sit permanently green between turns.
            savedTimerRef.current = setTimeout(() => {
              setSaveStatus('idle');
              savedTimerRef.current = null;
            }, 1500);
          })
          .catch(() => setSaveStatus('idle'));
      },
    });
    handleRef.current = handle;
    handle.done
      .then(() => writesRef.current)
      .then(() => {
        setStatus('done');
        props.onDone?.();
      });
    return () => {
      handle.abort();
    };
  }, [phase]);

  useInput((input, key) => {
    if (phase !== 'running' || !state) return;
    if (state.phase !== 'debate') return;
    if (editorBusy) return;
    // Ctrl+G — open the spec in $EDITOR. On exit, dispatch the new body.
    if (key.ctrl && input === 'g') {
      openSpecInEditor();
    }
  });

  const openSpecInEditor = (): void => {
    if (!state || state.phase !== 'debate') return;
    const editor = process.env.EDITOR || process.env.VISUAL || 'vim';
    const dir = mkdtempSync(join(tmpdir(), 'bramble-edit-'));
    const file = join(dir, 'spec.md');
    const before = state.spec;
    setEditorBusy(true);
    setStatus(`opening ${editor}…`);
    try {
      writeFileSync(file, before, 'utf8');
      try {
        stdinCtx.setRawMode?.(false);
      } catch { /* ignore */ }
      stdinCtx.stdin?.pause?.();
      // Vim toggles its own alt screen, which can pop us out of bramble's on
      // exit. Briefly leave our alt screen for the editor, then re-enter so
      // the TUI re-takes the full window when control returns.
      process.stdout.write('\x1b[?1049l');
      spawnSync(editor, [file], { stdio: 'inherit' });
      process.stdout.write('\x1b[?1049h\x1b[H');
      try {
        stdinCtx.setRawMode?.(true);
      } catch { /* ignore */ }
      stdinCtx.stdin?.resume?.();
      const after = readFileSync(file, 'utf8');
      if (after !== before) {
        handleRef.current?.userEdit(after);
        setStatus(`spec edited (${after.length - before.length >= 0 ? '+' : ''}${after.length - before.length}c)`);
      } else {
        setStatus('spec unchanged');
      }
    } catch (e) {
      setStatus(`edit failed: ${(e as Error).message}`);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      setEditorBusy(false);
    }
  };

  if (phase === 'setup') {
    return (
      <SetupScreen
        sessionName={props.sessionName}
        initialPrompt={initialPrompt}
        initialMode={mode}
        initialModels={
          props.initialModelConfig ?? {
            claudeModel: null,
            claudeEffort: null,
            codexModel: null,
            codexEffort: null,
          }
        }
        onSubmit={({ prompt: p, mode: m, models }) => {
          setPrompt(p);
          setMode(m);
          if (props.buildAgents) {
            setActiveAgents(props.buildAgents(models));
          }
          if (props.setupStorePath) {
            try {
              saveSetup(props.setupStorePath, {
                mode: m,
                claudeModel: models.claudeModel,
                claudeEffort: models.claudeEffort,
                codexModel: models.codexModel,
                codexEffort: models.codexEffort,
              });
            } catch {
              /* best-effort */
            }
          }
          setStatus('starting…');
          setUiPhase('running');
        }}
        onQuit={() => props.onQuit?.()}
      />
    );
  }

  if (!state) {
    return (
      <Box padding={1}>
        <Text dimColor>booting…</Text>
      </Box>
    );
  }

  const wide = dims.columns >= 100;
  const sidebarWidth = wide ? 32 : 0;
  const remaining = Math.max(20, dims.columns - sidebarWidth);
  const conversationWidth = Math.floor(remaining / 2);
  const specMaxLines = Math.max(4, dims.rows - 10);
  // Each conversation entry takes roughly 3 rows (header + 1-2 lines of body
  // + a margin row). Estimate how many fit in the conversation pane and cap
  // there so flex-end + overflow-hidden can crop cleanly at the top instead
  // of the slice leaving a half-empty pane.
  const conversationMaxEntries = Math.max(8, Math.floor((dims.rows - 10) / 3));
  const modelConfig: ModelConfig = props.initialModelConfig ?? {
    claudeModel: null,
    claudeEffort: null,
    codexModel: null,
    codexEffort: null,
  };

  const titleText = `Bramble: Collaborative spec creation with Claude & Codex`;
  const mode_pill: SpecMode = specMode(state);

  return (
    <Box flexDirection="column" width={dims.columns} height={dims.rows}>
      <Box paddingX={1} flexShrink={0} justifyContent="space-between">
        <Text>
          <Text color="greenBright" bold>✦ bramble</Text>
          <Text dimColor>  v0.1.0</Text>
        </Text>
        {dims.columns >= 110 ? (
          <Text dimColor>{truncate(titleText, dims.columns - 60)}</Text>
        ) : null}
        <Text>
          <Text dimColor>session: </Text>
          <Text color="cyan">{props.sessionName}</Text>
          <Text dimColor>  ·  {status}</Text>
        </Text>
      </Box>
      {!wide && (
        <Box paddingX={1} flexShrink={0}>
          <Text>
            <Text color="greenBright">✦ </Text>
            <Text color="greenBright" bold>You</Text>
            <Text dimColor> · </Text>
            <Text color="#FF8C42">☀ </Text>
            <Text color="#FF8C42" bold>Claude</Text>
            {state.speaker === 'claude' ? (
              <Text color="yellow"> ⏳</Text>
            ) : null}
            <Text dimColor> · </Text>
            <Text color="cyan">⊛ </Text>
            <Text color="cyan" bold>Codex</Text>
            {state.speaker === 'codex' ? (
              <Text color="yellow"> ⏳</Text>
            ) : null}
            {paused ? <Text color="yellow"> · paused</Text> : null}
          </Text>
        </Box>
      )}

      <Box flexGrow={1} flexDirection="row">
        {wide && (
          <Box
            flexDirection="column"
            width={sidebarWidth}
            flexShrink={0}
          >
            <Box
              flexDirection="column"
              borderStyle="single"
              flexShrink={0}
              overflow="hidden"
            >
              <ParticipantsBox state={state} />
            </Box>
            <Box
              flexDirection="column"
              borderStyle="single"
              flexGrow={1}
              overflow="hidden"
            >
              <FlowBox state={state} />
            </Box>
          </Box>
        )}
        <Box
          flexDirection="column"
          width={conversationWidth}
          flexShrink={0}
        >
          <Box
            flexDirection="column"
            borderStyle="single"
            flexGrow={1}
            overflow="hidden"
          >
            <ConversationPane state={state} maxEntries={conversationMaxEntries} />
          </Box>
          <Box
            flexDirection="column"
            borderStyle="single"
            flexShrink={0}
            paddingX={1}
          >
            <Text dimColor>
              {state.phase === 'interview' &&
              (state.speaker === 'claude' || state.speaker === 'codex')
                ? `${state.speaker === 'claude' ? 'Claude' : 'Codex'} is asking — input disabled until their question lands…`
                : 'Your message (↵ to send, ⇧+↵ for newline)'}
            </Text>
            <InputBox
          disabled={
            state.phase === 'interview' &&
            (state.speaker === 'claude' || state.speaker === 'codex')
          }
          allowEmptySubmit={mode === 'collab'}
          onSubmit={line => {
            if (line === '' && mode === 'collab' && paused) {
              handleRef.current?.continue();
              return;
            }
            const cmd = parseSlashCommand(line);
            if (cmd === null) {
              handleRef.current?.interject(line);
              setStatus(`sent: ${line.slice(0, 40)}`);
              return;
            }
            if (cmd.kind === 'quit') {
              handleRef.current?.abort();
              props.onQuit?.();
              return;
            }
            if (cmd.kind === 'done') {
              handleRef.current?.done_interview();
              setStatus(
                state.awaitingSignoff
                  ? 'finalizing'
                  : 'skipping ahead to debate',
              );
              return;
            }
            if (cmd.kind === 'rounds') {
              if (cmd.value !== null) {
                handleRef.current?.updateConfig({ maxRounds: cmd.value });
                setStatus(`maxRounds → ${cmd.value}`);
              }
              return;
            }
            if (cmd.kind === 'threshold') {
              handleRef.current?.updateConfig({ decayThreshold: cmd.value });
              setStatus(`threshold → ${cmd.value}`);
              return;
            }
            if (cmd.kind === 'decay') {
              handleRef.current?.updateConfig({ decayWindow: cmd.value });
              setStatus(`decay window → ${cmd.value}`);
              return;
            }
            if (cmd.kind === 'context') {
              handleRef.current?.addContext(cmd.value);
              setStatus(`context added (${cmd.value.length}c)`);
              return;
            }
            setStatus(cmd.hint ?? `unknown command`);
          }}
          onQuit={() => {
            handleRef.current?.abort();
            props.onQuit?.();
          }}
        />
          </Box>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="single"
          flexGrow={1}
          overflow="hidden"
        >
          <SpecPane
            text={state.spec}
            title={basename(props.specPath)}
            maxLines={specMaxLines}
            saveStatus={saveStatus}
            mode={mode_pill}
          />
        </Box>
      </Box>
      <StatusStrip state={state} models={modelConfig} />
      <Box paddingX={1}>
        <Text dimColor>
          {state.phase === 'interview'
            ? 'answer the question · /context <text> to add detail · /done to skip ahead · /quit'
            : state.awaitingSignoff
              ? 'type to revise · /context <text> · ^G edit spec · /done to finalize · /quit'
              : '/context <text> · ^G edit spec · /rounds N · /threshold N · /decay N · /quit'}
        </Text>
      </Box>
    </Box>
  );
}

function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

function specMode(state: State): SpecMode {
  if (state.phase === 'done') return { label: 'DONE', color: 'green' };
  if (state.awaitingSignoff) return { label: 'SIGNOFF', color: 'yellow' };
  if (state.phase === 'interview') return { label: 'INTERVIEW', color: 'gray' };
  const anyLgtm =
    state.lgtmThisRound.length > 0 ||
    state.debate.some(t => t.verdict === 'lgtm');
  return anyLgtm
    ? { label: 'REFINE', color: 'magenta' }
    : { label: 'DRAFT', color: 'cyan' };
}

