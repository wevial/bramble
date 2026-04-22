import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import type { Agent } from '../agents/agent.js';
import { startDebate, type DebateHandle } from '../orchestrator/runner.js';
import { writeAcceptedSpec, clearSpec } from '../docs/spec.js';
import { writeDebate } from '../docs/debate.js';
import { writeDraft, clearDraft } from '../docs/draft.js';
import type { State, TurnRecord } from '../orchestrator/types.js';
import { parseAgentOutput, type AgentOutput } from '../protocol/patch.js';
import { InputBox } from './InputBox.js';
import { parseSlashCommand } from './commands.js';

export type AppProps = {
  agents: { claude: Agent; codex: Agent };
  prompt: string;
  rounds: number;
  transcriptPath: string;
  specPath: string;
  debatePath: string;
  draftPath: string;
  onDone?: () => void;
  onQuit?: () => void;
};

export function App(props: AppProps) {
  const [live, setLive] = useState<{ claude: string; codex: string }>({
    claude: '',
    codex: '',
  });
  const [state, setState] = useState<State>({
    speaker: 'idle',
    transcript: [],
    currentDraft: null,
    accepted: false,
  });
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<string>('starting…');
  const [rounds, setRounds] = useState(props.rounds);
  const handleRef = useRef<DebateHandle | null>(null);
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
        void writeDebate(
          props.debatePath,
          next.transcript.map(t => ({ speaker: t.speaker, content: t.content })),
        );
        // draft.md = whatever is in-debate; spec.md = accepted only.
        if (next.accepted && next.currentDraft) {
          void writeAcceptedSpec(props.specPath, next.currentDraft.body);
          void clearDraft(props.draftPath);
        } else if (next.currentDraft) {
          void writeDraft(props.draftPath, next.currentDraft.body);
          void clearSpec(props.specPath);
        }
      },
    });
    handleRef.current = handle;

    handle.done.then(() => {
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

  const activeSpeaker = state.speaker;
  const sidebarWidth = Math.max(32, Math.min(60, Math.floor(dims.columns * 0.4)));
  const chatWidth = Math.max(20, dims.columns - sidebarWidth);
  // dims.rows minus: input box (3) + status row (1) + chat border (2) = 6
  const chatBodyRows = Math.max(4, dims.rows - 6);
  // chat interior after border (2) + paddingX (2)
  const chatInnerWidth = Math.max(10, chatWidth - 4);

  return (
    <Box flexDirection="column" width={dims.columns} height={dims.rows}>
      <Box flexGrow={1}>
        <ChatLog
          transcript={state.transcript}
          activeSpeaker={activeSpeaker}
          liveClaude={live.claude}
          liveCodex={live.codex}
          width={chatWidth}
          innerWidth={chatInnerWidth}
          bodyRows={chatBodyRows}
        />
        <SpecSidebar state={state} width={sidebarWidth} />
      </Box>

      <Box borderStyle="single" paddingX={1}>
        <InputBox
          onSubmit={line => {
            const cmd = parseSlashCommand(line);
            if (cmd === null) {
              handleRef.current?.interject(line);
              setStatus(`interjected: ${line.slice(0, 40)}`);
              return;
            }
            if (cmd.kind === 'quit') {
              handleRef.current?.abort();
              props.onQuit?.();
              return;
            }
            if (cmd.kind === 'rounds') {
              if (cmd.value === null) {
                const current = handleRef.current?.getRounds() ?? rounds;
                setStatus(`rounds: ${current}`);
              } else {
                handleRef.current?.setRounds(cmd.value);
                setRounds(cmd.value);
                setStatus(`rounds → ${cmd.value}`);
              }
              return;
            }
            setStatus(cmd.hint);
          }}
          onQuit={() => {
            handleRef.current?.abort();
            props.onQuit?.();
          }}
        />
      </Box>
      <Box paddingX={1}>
        <Text dimColor>
          {done ? 'done' : `speaker: ${activeSpeaker}`} · rounds {rounds} · {status} · /rounds N · /quit
        </Text>
      </Box>
    </Box>
  );
}

type ChatItem = {
  speaker: 'claude' | 'codex' | 'user';
  content: string;
  streaming?: boolean;
  /** Parsed structured output (completed turns only). */
  parsed?: AgentOutput;
  /** True when a later turn from the same speaker has a proposal of its own. */
  proposalSuperseded?: boolean;
};

function ChatLog({
  transcript,
  activeSpeaker,
  liveClaude,
  liveCodex,
  width,
  innerWidth,
  bodyRows,
}: {
  transcript: TurnRecord[];
  activeSpeaker: State['speaker'];
  liveClaude: string;
  liveCodex: string;
  width: number;
  innerWidth: number;
  bodyRows: number;
}) {
  // Build parsed items + supersession info: a proposal is superseded when a
  // later turn from the same speaker also carries a proposal.
  const parsedTurns = transcript.map(t => {
    const res = parseAgentOutput(t.content, { fallbackToCommentary: true });
    return { turn: t, parsed: res.ok ? res.value : undefined };
  });
  const lastProposalIdxBySpeaker: Record<string, number> = {};
  parsedTurns.forEach((pt, i) => {
    if (pt.parsed?.proposal && (pt.turn.speaker === 'claude' || pt.turn.speaker === 'codex')) {
      lastProposalIdxBySpeaker[pt.turn.speaker] = i;
    }
  });

  const items: ChatItem[] = parsedTurns.map((pt, i) => ({
    speaker: pt.turn.speaker,
    content: pt.parsed?.commentary ?? pt.turn.content,
    parsed: pt.parsed,
    proposalSuperseded:
      pt.parsed?.proposal != null &&
      lastProposalIdxBySpeaker[pt.turn.speaker] !== i,
  }));
  if (activeSpeaker === 'claude' && liveClaude.length > 0) {
    items.push({ speaker: 'claude', content: liveClaude, streaming: true });
  } else if (activeSpeaker === 'codex' && liveCodex.length > 0) {
    items.push({ speaker: 'codex', content: liveCodex, streaming: true });
  }

  const lines = tailChatLines(items, innerWidth, bodyRows);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      paddingX={1}
      width={width}
      flexShrink={0}
    >
      {lines.length === 0 ? (
        <Text dimColor>(no turns yet)</Text>
      ) : (
        lines.map((l, i) => <ChatLine key={i} line={l} />)
      )}
    </Box>
  );
}

type RenderLine =
  | { kind: 'blank' }
  | {
      kind: 'label';
      speaker: 'claude' | 'codex' | 'user';
      streaming?: boolean;
      labelText: string;
      bodyText: string;
    }
  | { kind: 'cont'; text: string }
  | {
      kind: 'proposalHeader';
      speaker: 'claude' | 'codex';
      collapsed: boolean;
      lines: number;
    }
  | { kind: 'proposalBody'; text: string }
  | { kind: 'proposalFooter' }
  | { kind: 'verdict'; speaker: 'claude' | 'codex'; verdict: 'LGTM' | 'counter' };

const PROPOSAL_SUMMARY_LINES = 6;

function tailChatLines(
  items: ChatItem[],
  width: number,
  maxLines: number,
): RenderLine[] {
  const all: RenderLine[] = [];
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]!;
    if (idx > 0) all.push({ kind: 'blank' });
    const label = `${item.streaming ? '● ' : ''}${item.speaker}: `;
    const firstCap = Math.max(4, width - label.length);
    const contCap = Math.max(4, width - 2);

    const nl = item.content.indexOf('\n');
    const firstPara = nl >= 0 ? item.content.slice(0, nl) : item.content;
    const firstBody = firstPara.slice(0, firstCap);
    all.push({
      kind: 'label',
      speaker: item.speaker,
      streaming: item.streaming,
      labelText: label,
      bodyText: firstBody,
    });

    const remainder =
      firstPara.slice(firstCap) + (nl >= 0 ? item.content.slice(nl) : '');
    if (remainder.length > 0) {
      for (const w of wrapLines(remainder, contCap)) {
        all.push({ kind: 'cont', text: '  ' + w });
      }
    }

    // Proposal block (only for agent turns).
    if (
      item.parsed?.proposal &&
      (item.speaker === 'claude' || item.speaker === 'codex')
    ) {
      const body = item.parsed.proposal.body;
      const totalLines = body.split('\n').length;
      const collapsed = item.proposalSuperseded === true;
      all.push({
        kind: 'proposalHeader',
        speaker: item.speaker,
        collapsed,
        lines: totalLines,
      });
      if (!collapsed) {
        const preview = body.split('\n').slice(0, PROPOSAL_SUMMARY_LINES);
        for (const bodyLine of preview) {
          for (const w of wrapLines(bodyLine, Math.max(4, width - 4))) {
            all.push({ kind: 'proposalBody', text: w });
          }
        }
        if (totalLines > PROPOSAL_SUMMARY_LINES) {
          all.push({
            kind: 'proposalBody',
            text: `… +${totalLines - PROPOSAL_SUMMARY_LINES} more lines (see draft.md)`,
          });
        }
        all.push({ kind: 'proposalFooter' });
      }
    }

    if (
      item.parsed?.verdict &&
      (item.speaker === 'claude' || item.speaker === 'codex')
    ) {
      all.push({
        kind: 'verdict',
        speaker: item.speaker,
        verdict: item.parsed.verdict,
      });
    }
  }
  return all.slice(-maxLines);
}

function wrapLines(text: string, width: number): string[] {
  const out: string[] = [];
  if (width < 1) return [text];
  for (const raw of text.split('\n')) {
    if (raw.length === 0) {
      out.push('');
      continue;
    }
    for (let i = 0; i < raw.length; i += width) {
      out.push(raw.slice(i, i + width));
    }
  }
  return out;
}

function ChatLine({ line }: { line: RenderLine }) {
  if (line.kind === 'blank') return <Text> </Text>;
  if (line.kind === 'cont') return <Text>{line.text}</Text>;
  if (line.kind === 'label') {
    return (
      <Text>
        <Text color={colorFor(line.speaker)} bold>
          {line.labelText}
        </Text>
        {line.bodyText}
      </Text>
    );
  }
  if (line.kind === 'proposalHeader') {
    const c = colorFor(line.speaker);
    if (line.collapsed) {
      return (
        <Text dimColor>
          <Text color={c}>▸ {line.speaker}</Text> proposal — {line.lines} lines (superseded)
        </Text>
      );
    }
    return (
      <Text>
        <Text color={c}>┌── {line.speaker} proposal ──</Text>
      </Text>
    );
  }
  if (line.kind === 'proposalBody') {
    return (
      <Text>
        <Text dimColor>│ </Text>
        {line.text}
      </Text>
    );
  }
  if (line.kind === 'proposalFooter') {
    return (
      <Text dimColor>└──</Text>
    );
  }
  // verdict
  const color = line.verdict === 'LGTM' ? 'green' : 'yellow';
  const tag = line.verdict === 'LGTM' ? '✓ LGTM' : '↺ counter';
  return (
    <Text>
      <Text color={colorFor(line.speaker)} dimColor>
        {line.speaker}{' '}
      </Text>
      <Text color={color} bold>
        {tag}
      </Text>
    </Text>
  );
}

function SpecSidebar({ state, width }: { state: State; width: number }) {
  const { currentDraft, accepted, transcript } = state;
  const hasAccepted = accepted && currentDraft !== null;
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      paddingX={1}
      width={width}
      flexShrink={0}
    >
      <Text bold>spec.md</Text>
      {hasAccepted ? (
        <>
          <Text color="green">✓ accepted</Text>
          <Text dimColor>by {currentDraft!.proposer}</Text>
          <Text wrap="wrap">{currentDraft!.body}</Text>
        </>
      ) : (
        <Text dimColor>
          (nothing accepted yet
          {currentDraft ? ' — see draft.md for current proposal)' : ')'}
        </Text>
      )}
      <Text dimColor>—</Text>
      <Text dimColor>
        {transcript.length} turn{transcript.length === 1 ? '' : 's'}
      </Text>
    </Box>
  );
}

function commentaryOf(raw: string): string {
  const parsed = parseAgentOutput(raw, { fallbackToCommentary: true });
  return parsed.ok ? parsed.value.commentary : raw;
}

function colorFor(speaker: 'claude' | 'codex' | 'user'): string {
  return speaker === 'claude' ? 'cyan' : speaker === 'codex' ? 'magenta' : 'yellow';
}
