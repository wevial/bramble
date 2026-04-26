import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
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
import { MarkdownBlock } from './markdown.js';
import type { ModelConfig } from './models.js';
import { SetupScreen } from './SetupScreen.js';
import { saveSetup } from './setup-store.js';

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
        writesRef.current = writesRef.current
          .then(() => writeSpec(props.specPath, spec))
          .then(() => writeInterviewMd(props.interviewPath, interview, answers))
          .then(() => writeDebateLedger(props.debatePath, debate))
          .catch(() => {});
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

  return (
    <Box flexDirection="column" width={dims.columns} height={dims.rows}>
      <Box paddingX={1} flexShrink={0}>
        <Text>
          <Text color="greenBright" bold>
            ✦ bramble
          </Text>
          <Text dimColor> · </Text>
          <Text>{props.sessionName}</Text>
          <Text dimColor> · </Text>
          <Text color={phaseColor(state.phase)}>{state.phase}</Text>
          <Text dimColor> · </Text>
          {state.phase === 'debate' && (
            <Text>
              round {state.round}/{state.config.maxRounds}
              <Text dimColor> · </Text>
              {state.lgtmThisRound.length}/2 LGTM
              <Text dimColor> · </Text>
              vol{' '}
              {state.roundVolumes.length === 0
                ? '—'
                : state.roundVolumes[state.roundVolumes.length - 1]}
              <Text dimColor>/{state.config.decayThreshold}</Text>
              <Text dimColor> · </Text>
            </Text>
          )}
          {state.endReason && (
            <Text color="green">{`ended: ${state.endReason}`}</Text>
          )}
          {!state.endReason && (
            <Text>
              <Text dimColor>speaker </Text>
              <Text>{state.speaker}</Text>
            </Text>
          )}
          {paused && (
            <Text>
              <Text dimColor> · </Text>
              <Text color="yellow">paused</Text>
            </Text>
          )}
          <Text dimColor> · </Text>
          <Text dimColor>{status}</Text>
        </Text>
      </Box>

      <Box flexGrow={1} flexDirection="row">
        <Box
          flexDirection="column"
          borderStyle="single"
          paddingX={1}
          width={Math.floor(dims.columns / 2)}
          flexShrink={0}
          overflow="hidden"
        >
          <Text bold color="cyan">
            {state.phase === 'interview' ? 'interview' : 'debate log'}
          </Text>
          <Text dimColor>{'─'.repeat(Math.max(4, Math.floor(dims.columns / 2) - 4))}</Text>
          {state.phase === 'interview'
            ? renderInterview(state)
            : renderDebate(state)}
        </Box>
        <Box
          flexDirection="column"
          borderStyle="single"
          paddingX={1}
          flexGrow={1}
          overflow="hidden"
        >
          <Text bold color="green">
            spec.md
          </Text>
          <Text dimColor>{'─'.repeat(Math.max(4, Math.floor(dims.columns / 2) - 4))}</Text>
          {state.spec.length === 0 ? (
            <Text dimColor>(empty — no edits yet)</Text>
          ) : (
            <MarkdownBlock text={state.spec} maxLines={dims.rows - 8} />
          )}
        </Box>
      </Box>

      <Box borderStyle="single" paddingX={1}>
        <InputBox
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
              setStatus('skipping ahead to debate');
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
            setStatus(cmd.hint ?? `unknown command`);
          }}
          onQuit={() => {
            handleRef.current?.abort();
            props.onQuit?.();
          }}
        />
      </Box>
      <Box paddingX={1}>
        <Text dimColor>
          {state.phase === 'interview'
            ? 'answer the question, or /done to skip ahead · /quit to exit'
            : '/rounds N · /threshold N · /decay N · /quit'}
        </Text>
      </Box>
    </Box>
  );
}

function renderInterview(state: State) {
  if (state.interview.length === 0) {
    return (
      <Text dimColor>
        {state.speaker === 'idle' ? 'starting up…' : `${state.speaker} is thinking…`}
      </Text>
    );
  }
  // Build full Q&A interleaved, then keep the tail so older turns scroll off
  // gracefully (Ink doesn't auto-scroll — without a tail the labels at the
  // top get clipped first, leaving rows of bare text).
  const items: React.ReactNode[] = [];
  let answerIdx = 0;
  for (let i = 0; i < state.interview.length; i++) {
    const t = state.interview[i]!;
    items.push(
      <Box key={`t${i}`} flexDirection="column" marginBottom={1}>
        <Text color={t.speaker === 'claude' ? 'cyan' : 'magenta'} bold>
          {t.speaker}
          {t.ready ? <Text color="green"> · ready</Text> : null}
        </Text>
        {t.commentary ? <Text>{t.commentary}</Text> : null}
        {t.question ? (
          <Text color="yellow">
            ? {t.question}
          </Text>
        ) : null}
      </Box>,
    );
    const ans = state.userAnswers[answerIdx];
    if (ans && Date.parse(ans.timestamp) >= Date.parse(t.timestamp)) {
      items.push(
        <Box key={`a${i}`} flexDirection="column" marginBottom={1}>
          <Text color="white" bold>
            user
          </Text>
          <Text>{ans.content}</Text>
        </Box>,
      );
      answerIdx++;
    }
  }
  return <>{items.slice(-6)}</>;
}

function renderDebate(state: State) {
  if (state.debate.length === 0) {
    return (
      <Text dimColor>
        {state.speaker === 'idle'
          ? 'starting up…'
          : `${state.speaker} is thinking…`}
      </Text>
    );
  }
  // Show the last 8 turns.
  const slice = state.debate.slice(-8);
  return (
    <>
      {slice.map((t, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <Text color={t.speaker === 'claude' ? 'cyan' : 'magenta'} bold>
            {t.speaker} · r{t.round} ·{' '}
            <Text color={t.verdict === 'lgtm' ? 'green' : 'yellow'}>
              {t.verdict}
            </Text>
            {t.applied.length > 0 ? (
              <Text dimColor> · {t.applied.length} edits ({t.charsChanged}c)</Text>
            ) : null}
            {t.rejected.length > 0 ? (
              <Text color="red"> · {t.rejected.length} rejected</Text>
            ) : null}
          </Text>
          {t.commentary ? <Text>{t.commentary}</Text> : null}
        </Box>
      ))}
    </>
  );
}

function phaseColor(p: 'interview' | 'debate' | 'done'): string {
  return p === 'interview' ? 'yellow' : p === 'debate' ? 'cyan' : 'green';
}
