import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import type { Agent } from '../agents/agent.js';
import { startDebate, type DebateHandle } from '../orchestrator/runner.js';
import { appendSpecTurn } from '../docs/spec.js';
import { writeDebate } from '../docs/debate.js';
import type { State, TurnRecord } from '../orchestrator/types.js';
import { InputBox } from './InputBox.js';

export type AppProps = {
  agents: { claude: Agent; codex: Agent };
  prompt: string;
  rounds: number;
  transcriptPath: string;
  specPath: string;
  debatePath: string;
  onDone?: () => void;
  onQuit?: () => void;
};

export function App(props: AppProps) {
  const [live, setLive] = useState<{ claude: string; codex: string }>({
    claude: '',
    codex: '',
  });
  const [state, setState] = useState<State>({ speaker: 'idle', transcript: [] });
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<string>('starting…');
  const handleRef = useRef<DebateHandle | null>(null);
  const lastTurnCountRef = useRef(0);
  const { stdout } = useStdout();
  const [dims, setDims] = useState({
    rows: stdout?.rows ?? 24,
    columns: stdout?.columns ?? 80,
  });

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setDims({ rows: stdout.rows, columns: stdout.columns });
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  useEffect(() => {
    let currentSpeaker: 'claude' | 'codex' | null = null;
    // Token buffer: tokens accumulate here and flush to React state on a
    // timer so the UI updates in smooth chunks instead of per-char flicker.
    const pending = { claude: '', codex: '' };
    const FLUSH_MS = 80;
    const flush = setInterval(() => {
      if (pending.claude === '' && pending.codex === '') return;
      setLive(prev => ({
        claude: prev.claude + pending.claude,
        codex: prev.codex + pending.codex,
      }));
      pending.claude = '';
      pending.codex = '';
    }, FLUSH_MS);

    const handle = startDebate({
      agents: props.agents,
      prompt: props.prompt,
      rounds: props.rounds,
      transcriptPath: props.transcriptPath,
      onToken: (who, text) => {
        if (who !== currentSpeaker) {
          currentSpeaker = who;
          setLive(prev => ({ ...prev, [who]: '' }));
        }
        pending[who] += text;
      },
      onState: next => {
        setState(next);
        // persist any newly-completed turns to spec.md + debate.md
        for (let i = lastTurnCountRef.current; i < next.transcript.length; i++) {
          const t = next.transcript[i]!;
          void appendSpecTurn(props.specPath, { speaker: t.speaker, content: t.content });
        }
        lastTurnCountRef.current = next.transcript.length;
        void writeDebate(
          props.debatePath,
          next.transcript.map(t => ({ speaker: t.speaker, content: t.content })),
        );
      },
    });
    handleRef.current = handle;

    handle.done.then(() => {
      // final flush so any tail tokens land
      setLive(prev => ({
        claude: prev.claude + pending.claude,
        codex: prev.codex + pending.codex,
      }));
      pending.claude = '';
      pending.codex = '';
      setDone(true);
      setStatus('done');
      props.onDone?.();
    });

    return () => {
      clearInterval(flush);
      handle.abort();
    };
  }, []);

  const claudeTurns = state.transcript.filter(t => t.speaker === 'claude');
  const codexTurns = state.transcript.filter(t => t.speaker === 'codex');
  const activeSpeaker = state.speaker;

  const sidebarWidth = Math.max(20, Math.min(36, Math.floor(dims.columns * 0.28)));

  return (
    <Box flexDirection="column" width={dims.columns} height={dims.rows}>
      <Box flexGrow={1}>
        <Box flexDirection="column" flexGrow={1}>
          <SpeakerPane
            title="Claude"
            active={activeSpeaker === 'claude'}
            live={live.claude}
            lastTurn={last(claudeTurns)}
          />
          <SpeakerPane
            title="Codex"
            active={activeSpeaker === 'codex'}
            live={live.codex}
            lastTurn={last(codexTurns)}
          />
          <DebateStrip transcript={state.transcript} />
        </Box>
        <SpecSidebar transcript={state.transcript} width={sidebarWidth} />
      </Box>

      <Box borderStyle="single" paddingX={1}>
        <InputBox
          disabled={done}
          onSubmit={line => {
            handleRef.current?.interject(line);
            setStatus(`interjected: ${line.slice(0, 40)}`);
          }}
          onQuit={() => {
            handleRef.current?.abort();
            props.onQuit?.();
          }}
        />
      </Box>
      <Box paddingX={1}>
        <Text dimColor>
          {done ? 'done' : `speaker: ${activeSpeaker}`} · {status} · Ctrl-C abort · /quit to exit
        </Text>
      </Box>
    </Box>
  );
}

function SpeakerPane({
  title,
  active,
  live,
  lastTurn,
}: {
  title: string;
  active: boolean;
  live: string;
  lastTurn: TurnRecord | undefined;
}) {
  const body = active ? live : lastTurn?.content ?? '(no turn yet)';
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      paddingX={1}
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      overflow="hidden"
    >
      <Text bold color={active ? 'green' : undefined}>
        {title}
        {active ? ' ●' : lastTurn ? ' (last turn)' : ''}
      </Text>
      <Text wrap="wrap">{body}</Text>
    </Box>
  );
}

function DebateStrip({ transcript }: { transcript: TurnRecord[] }) {
  const tail = transcript.slice(-4);
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold dimColor>
        debate
      </Text>
      {tail.length === 0 ? (
        <Text dimColor>(no turns yet)</Text>
      ) : (
        tail.map((t, i) => (
          <Text key={i}>
            <Text color={colorFor(t.speaker)}>{t.speaker}</Text>: {oneLine(t.content)}
          </Text>
        ))
      )}
    </Box>
  );
}

function SpecSidebar({ transcript, width }: { transcript: TurnRecord[]; width: number }) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={width} flexShrink={0}>
      <Text bold>spec.md</Text>
      <Text dimColor>{transcript.length} turns recorded</Text>
      <Text dimColor>(sections land in Phase 2)</Text>
    </Box>
  );
}

function colorFor(speaker: 'claude' | 'codex' | 'user'): string {
  return speaker === 'claude' ? 'cyan' : speaker === 'codex' ? 'magenta' : 'yellow';
}

function oneLine(s: string): string {
  const trimmed = s.replace(/\s+/g, ' ').trim();
  return trimmed.length > 60 ? trimmed.slice(0, 57) + '…' : trimmed;
}

function last<T>(xs: T[]): T | undefined {
  return xs.length > 0 ? xs[xs.length - 1] : undefined;
}
