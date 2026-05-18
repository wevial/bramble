import React, { useEffect, useRef, useState } from 'react';
import { createTextAttributes } from '@opentui/core';
import { useKeyboard, useRenderer, useSelectionHandler, useTerminalDimensions } from '@opentui/react';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Agent } from '../agents/agent.js';
import type { Moderator } from '../moderator/moderator.js';
import {
  startDebate,
  type RunHandle,
  type DebateMode,
} from '../orchestrator/runner.js';
import { writeSpec } from '../docs/spec.js';
import { type OutputFormat, convertSpec } from '../docs/format.js';
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
import {
  CLAUDE_PERSONA,
  CODEX_PERSONA,
  SPECIALIST_PERSONAS,
  type Persona,
  type PersonaId,
} from '../personas/personas.js';

const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });

export type AppProps = {
  agents: Record<PersonaId, Agent>;
  prompt?: string;
  sessionName: string;
  config?: Partial<DebateConfig>;
  mode?: DebateMode;
  initialState?: State;
  promptSidecarPath?: string;
  transcriptPath: string;
  specPath: string;
  outputFormat?: OutputFormat;
  debatePath: string;
  interviewPath: string;
  onDone?: () => void;
  onQuit?: () => void;
  skipPromptEntry?: boolean;
  /**
   * Build per-persona agents. Called when the user submits the setup form
   * with their chosen models + selected specialist personas. Returns a map
   * from persona ID to the Agent that should back that persona; the
   * orchestrator looks each speaker up here on every turn.
   */
  buildAgents?: (
    config: ModelConfig,
    personas: Persona[],
  ) => Record<PersonaId, Agent>;
  /**
   * Build a Moderator when the user enables it in setup. Receives the
   * personas active in the session so the moderator can describe them in
   * its prompt. Returns null/undefined when the build can't proceed.
   */
  buildModerator?: (personas: Persona[]) => Moderator | null;
  initialModelConfig?: ModelConfig;
  initialSpecialists?: PersonaId[];
  initialModerator?: boolean;
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
  const [activeModerator, setActiveModerator] = useState<Moderator | null>(null);
  const [activePersonas, setActivePersonas] = useState<Persona[]>(() => {
    const ids = props.initialState?.activePersonas ?? ['claude', 'codex'];
    const known = new Map<PersonaId, Persona>(
      [CLAUDE_PERSONA, CODEX_PERSONA, ...SPECIALIST_PERSONAS].map(p => [p.id, p]),
    );
    return ids.map(id => known.get(id) ?? CLAUDE_PERSONA);
  });
  const [prompt, setPrompt] = useState(initialPrompt);
  const [state, setState] = useState<State | null>(props.initialState ?? null);
  const [status, setStatus] = useState('starting…');
  const [paused, setPaused] = useState(false);
  const [mode, setMode] = useState<DebateMode>(props.mode ?? 'auto');
  const handleRef = useRef<RunHandle | null>(null);
  const writesRef = useRef<Promise<void>>(Promise.resolve());
  const renderer = useRenderer();
  const terminal = useTerminalDimensions();
  const [editorBusy, setEditorBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dims = {
    rows: terminal.height ?? 24,
    columns: terminal.width ?? 80,
  };

  useSelectionHandler(() => {});

  useEffect(() => {
    if (phase !== 'running' || !prompt) return;
    // First write of the session — create the session dir lazily so a
    // launch-and-quit on the setup screen doesn't leave an empty dir.
    const anyPath =
      props.promptSidecarPath ??
      props.transcriptPath ??
      props.specPath ??
      props.debatePath ??
      props.interviewPath;
    if (anyPath) {
      try { mkdirSync(dirname(anyPath), { recursive: true }); } catch { /* ignore */ }
    }
    if (props.promptSidecarPath) {
      import('node:fs/promises')
        .then(fs => fs.writeFile(props.promptSidecarPath!, prompt, 'utf8'))
        .catch(() => {});
    }
    const handle = startDebate({
      agents: activeAgents,
      personas: activePersonas,
      moderator: activeModerator ?? undefined,
      // Auto mode runs to signoff without pausing each round — the user
      // can interject at any time by typing. Per-round pauses turned out
      // to be too frequent for long debates. Collab mode still pauses
      // per-turn for users who want explicit checkpoints.
      pauseEachRound: false,
      criteriaStep: true,
      scoutStep: true,
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
        const outputFmt: OutputFormat = props.outputFormat ?? 'md';
        writesRef.current = writesRef.current
          .then(() => writeSpec(props.specPath, convertSpec(spec, outputFmt)))
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

  useKeyboard(key => {
    if (phase !== 'running' || !state) return;
    if (state.phase !== 'debate') return;
    if (editorBusy) return;
    // Ctrl+G — open the spec in $EDITOR. On exit, dispatch the new body.
    if (key.ctrl && key.name === 'g') {
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
        renderer.stdin.setRawMode?.(false);
      } catch { /* ignore */ }
      renderer.stdin.pause?.();
      renderer.suspend();
      spawnSync(editor, [file], { stdio: 'inherit' });
      renderer.resume();
      try {
        renderer.stdin.setRawMode?.(true);
      } catch { /* ignore */ }
      renderer.stdin.resume?.();
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
        initialSpecialists={props.initialSpecialists}
        initialModerator={props.initialModerator}
        onSubmit={({ prompt: p, mode: m, models, specialists, moderator }) => {
          setPrompt(p);
          setMode(m);
          const chosenSpecialists = SPECIALIST_PERSONAS.filter(s =>
            specialists.includes(s.id),
          );
          const personas: Persona[] = [
            CLAUDE_PERSONA,
            CODEX_PERSONA,
            ...chosenSpecialists,
          ];
          setActivePersonas(personas);
          if (props.buildAgents) {
            setActiveAgents(props.buildAgents(models, personas));
          }
          if (moderator && props.buildModerator) {
            setActiveModerator(props.buildModerator(personas));
          } else {
            setActiveModerator(null);
          }
          if (props.setupStorePath) {
            try {
              saveSetup(props.setupStorePath, {
                mode: m,
                claudeModel: models.claudeModel,
                claudeEffort: models.claudeEffort,
                codexModel: models.codexModel,
                codexEffort: models.codexEffort,
                specialists,
                moderator,
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
      <box padding={1}>
        <text><span attributes={DIM}>booting…</span></text>
      </box>
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
    <box flexDirection="column" width={dims.columns} height={dims.rows}>
      <box flexDirection="row" paddingX={1} flexShrink={0} justifyContent="space-between">
        <text>
          <span fg="brightGreen" attributes={BOLD}>✦ bramble</span>
          <span attributes={DIM}>  v0.1.0</span>
        </text>
        {dims.columns >= 110 ? (
          <text><span attributes={DIM}>{truncate(titleText, dims.columns - 60)}</span></text>
        ) : null}
        <text>
          <span attributes={DIM}>session: </span>
          <span fg="cyan">{props.sessionName}</span>
          <span attributes={DIM}>  ·  {status}</span>
        </text>
      </box>
      {!wide && (
        <box flexDirection="row" paddingX={1} flexShrink={0}>
          <text>
            <span fg="brightGreen">✦ </span>
            <span fg="brightGreen" attributes={BOLD}>You</span>
            <span attributes={DIM}> · </span>
            <span fg="#FF8C42">☀ </span>
            <span fg="#FF8C42" attributes={BOLD}>Claude</span>
            {state.speaker === 'claude' ? (
              <span fg="yellow"> ⏳</span>
            ) : null}
            <span attributes={DIM}> · </span>
            <span fg="cyan">⊛ </span>
            <span fg="cyan" attributes={BOLD}>Codex</span>
            {state.speaker === 'codex' ? (
              <span fg="yellow"> ⏳</span>
            ) : null}
            {paused ? <span fg="yellow"> · paused</span> : null}
          </text>
        </box>
      )}

      <box flexGrow={1} flexDirection="row">
        {wide && (
          <box
            flexDirection="column"
            width={sidebarWidth}
            flexShrink={0}
          >
            <box
              flexDirection="column"
              border borderStyle="single"
              flexShrink={0}
              overflow="hidden"
            >
              <ParticipantsBox state={state} />
            </box>
            <box
              flexDirection="column"
              border borderStyle="single"
              flexGrow={1}
              overflow="hidden"
            >
              <FlowBox state={state} />
            </box>
          </box>
        )}
        <box
          flexDirection="column"
          width={conversationWidth}
          flexShrink={0}
        >
          <box
            flexDirection="column"
            border borderStyle="single"
            flexGrow={1}
            overflow="hidden"
          >
            <ConversationPane state={state} maxEntries={conversationMaxEntries} />
          </box>
          <box
            flexDirection="column"
            border borderStyle="single"
            flexShrink={0}
            paddingX={1}
          >
            <text>
              <span attributes={DIM}>
              {state.phase === 'interview' &&
              (state.speaker === 'claude' || state.speaker === 'codex')
                ? `${state.speaker === 'claude' ? 'Claude' : 'Codex'} is asking — input disabled until their question lands…`
                : paused
                  ? 'Paused — ↵ to continue, or type a message to weigh in'
                  : 'Your message (↵ to send, ⇧+↵ for newline)'}
              </span>
            </text>
            <InputBox
          disabled={
            state.phase === 'interview' &&
            (state.speaker === 'claude' || state.speaker === 'codex')
          }
          allowEmptySubmit={paused}
          onSubmit={line => {
            // Empty submit while paused resumes the loop — covers both
            // collab-mode (every turn) and auto-mode's pauseEachRound
            // (between debate rounds). Typing anything goes through
            // interject so the agents see the input next round.
            if (line === '' && paused) {
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
          </box>
        </box>
        <box
          flexDirection="column"
          border borderStyle="single"
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
        </box>
      </box>
      <StatusStrip state={state} models={modelConfig} />
      <box paddingX={1}>
        <text>
          <span attributes={DIM}>
          {state.phase === 'interview'
            ? 'answer the question · /context <text> to add detail · /done to skip ahead · /quit'
            : state.phase === 'criteria'
              ? 'refine the criteria list · /context <text> · /done to lock criteria · /quit'
              : state.awaitingSignoff
                ? 'type to revise · /context <text> · ^G edit spec · /done to finalize · /quit'
                : '/context <text> · ^G edit spec · /rounds N · /threshold N · /decay N · /quit'}
          </span>
        </text>
      </box>
    </box>
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
  if (state.phase === 'criteria') return { label: 'CRITERIA', color: 'yellow' };
  const anyLgtm =
    state.lgtmThisRound.length > 0 ||
    state.debate.some(t => t.verdict === 'lgtm');
  return anyLgtm
    ? { label: 'REFINE', color: 'magenta' }
    : { label: 'DRAFT', color: 'cyan' };
}
