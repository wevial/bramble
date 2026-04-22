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
  const [state, setState] = useState<State>({
    speaker: 'idle',
    transcript: [],
    currentDraft: null,
    accepted: false,
  });
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<string>('starting…');
  const [rounds, setRounds] = useState(props.rounds);
  const [now, setNow] = useState(Date.now());
  const activeStartRef = useRef<number | null>(null);
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

  // Tick a timer only while an agent is active, so the "thinking Ns" indicator updates.
  useEffect(() => {
    if (state.speaker !== 'claude' && state.speaker !== 'codex') {
      activeStartRef.current = null;
      return;
    }
    if (activeStartRef.current === null) activeStartRef.current = Date.now();
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [state.speaker]);

  useEffect(() => {
    const handle = startDebate({
      agents: props.agents,
      prompt: props.prompt,
      rounds: props.rounds,
      transcriptPath: props.transcriptPath,
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
      setDone(true);
      setStatus('done');
      props.onDone?.();
    });

    return () => {
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

  const elapsedMs =
    (activeSpeaker === 'claude' || activeSpeaker === 'codex') &&
    activeStartRef.current !== null
      ? now - activeStartRef.current
      : 0;

  return (
    <Box flexDirection="column" width={dims.columns} height={dims.rows}>
      <Box flexGrow={1} height={chatBodyRows + 2}>
        <ChatLog
          goal={props.prompt}
          transcript={state.transcript}
          activeSpeaker={activeSpeaker}
          elapsedMs={elapsedMs}
          width={chatWidth}
          innerWidth={chatInnerWidth}
          bodyRows={chatBodyRows}
        />
        <SpecSidebar
          state={state}
          width={sidebarWidth}
          bodyRows={chatBodyRows}
        />
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
  goal,
  transcript,
  activeSpeaker,
  elapsedMs,
  width,
  innerWidth,
  bodyRows,
}: {
  goal: string;
  transcript: TurnRecord[];
  activeSpeaker: State['speaker'];
  elapsedMs: number;
  width: number;
  innerWidth: number;
  bodyRows: number;
}) {
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
  if (activeSpeaker === 'claude' || activeSpeaker === 'codex') {
    const secs = Math.floor(elapsedMs / 1000);
    items.push({
      speaker: activeSpeaker,
      content: `thinking… ${secs}s`,
      streaming: true,
    });
  }

  // Account for 2 header rows (goal + divider) before the chat body.
  const headerRows = 2;
  const availableRows = Math.max(1, bodyRows - headerRows);
  const lines = tailChatLines(items, innerWidth, availableRows);
  const goalLine = truncateOneLine(`goal: ${goal}`, innerWidth);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      paddingX={1}
      width={width}
      flexShrink={0}
      overflow="hidden"
    >
      <Text bold color="blue">
        {goalLine}
      </Text>
      <Text dimColor>{'─'.repeat(innerWidth)}</Text>
      {lines.length === 0 ? (
        <Text dimColor>(no turns yet)</Text>
      ) : (
        lines.map((l, i) => <ChatLine key={i} line={l} />)
      )}
    </Box>
  );
}

function truncateOneLine(s: string, max: number): string {
  const single = s.replace(/\s+/g, ' ').trim();
  return single.length > max ? single.slice(0, Math.max(0, max - 1)) + '…' : single;
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
  | { kind: 'proposalTop'; speaker: 'claude' | 'codex'; text: string }
  | { kind: 'proposalRow'; text: string }
  | { kind: 'proposalBottom'; text: string }
  | {
      kind: 'proposalCollapsed';
      speaker: 'claude' | 'codex';
      lines: number;
    }
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

    const paragraphs = item.content.split('\n');
    const firstPara = paragraphs[0] ?? '';
    const restParas = paragraphs.slice(1);

    // First paragraph wraps at firstCap (shared with label); continuations at contCap.
    const firstWrapped = wrapLines(firstPara, firstCap);
    const firstBody = firstWrapped[0] ?? '';
    all.push({
      kind: 'label',
      speaker: item.speaker,
      streaming: item.streaming,
      labelText: label,
      bodyText: firstBody,
    });
    for (const l of firstWrapped.slice(1)) {
      all.push({ kind: 'cont', text: '  ' + l });
    }
    for (const p of restParas) {
      if (p.length === 0) {
        all.push({ kind: 'cont', text: '' });
        continue;
      }
      for (const l of wrapLines(p, contCap)) {
        all.push({ kind: 'cont', text: '  ' + l });
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

      if (collapsed) {
        all.push({
          kind: 'proposalCollapsed',
          speaker: item.speaker,
          lines: totalLines,
        });
      } else {
        const boxWidth = Math.max(20, width);
        const innerCap = Math.max(4, boxWidth - 4);

        // ┌── <speaker> proposal ───...───┐
        const label = ` ${item.speaker} proposal `;
        const topLead = `──${label}`;
        const topFill = '─'.repeat(Math.max(0, boxWidth - 2 - topLead.length));
        all.push({
          kind: 'proposalTop',
          speaker: item.speaker,
          text: `┌${topLead}${topFill}┐`,
        });

        const rawLines = body.split('\n').slice(0, PROPOSAL_SUMMARY_LINES);
        const wrapped: string[] = [];
        for (const bodyLine of rawLines) {
          if (bodyLine.length === 0) {
            wrapped.push('');
          } else {
            wrapped.push(...wrapLines(bodyLine, innerCap));
          }
        }
        if (totalLines > PROPOSAL_SUMMARY_LINES) {
          wrapped.push(
            `… +${totalLines - PROPOSAL_SUMMARY_LINES} more (see draft.md)`,
          );
        }
        for (const w of wrapped) {
          const padded = (w + ' '.repeat(innerCap)).slice(0, innerCap);
          all.push({ kind: 'proposalRow', text: padded });
        }

        all.push({
          kind: 'proposalBottom',
          text: `└${'─'.repeat(boxWidth - 2)}┘`,
        });
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
    // Word-aware wrap: pack whitespace-separated tokens into lines of
    // <= width. A single token longer than width is hard-sliced so it
    // still fits (prefer clipping one word over emitting an overflow).
    const words = raw.split(/(\s+)/); // keep separators so spacing is preserved
    let line = '';
    for (const w of words) {
      if (w.length === 0) continue;
      if (line.length + w.length <= width) {
        line += w;
        continue;
      }
      // word doesn't fit; flush current line (if any)
      if (line.length > 0) {
        out.push(line.trimEnd());
        line = '';
      }
      if (w.length > width) {
        // oversized single token — hard-slice into width-sized chunks
        for (let i = 0; i < w.length; i += width) {
          const chunk = w.slice(i, i + width);
          if (chunk.length === width) out.push(chunk);
          else line = chunk;
        }
      } else if (/\S/.test(w)) {
        line = w;
      }
      // if it's pure whitespace and doesn't fit on the flushed line, drop it
    }
    if (line.length > 0) out.push(line.trimEnd());
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
  if (line.kind === 'proposalTop') {
    return (
      <Text color={colorFor(line.speaker)} dimColor>
        {line.text}
      </Text>
    );
  }
  if (line.kind === 'proposalRow') {
    return (
      <Text>
        <Text dimColor>│ </Text>
        {line.text}
        <Text dimColor> │</Text>
      </Text>
    );
  }
  if (line.kind === 'proposalBottom') {
    return <Text dimColor>{line.text}</Text>;
  }
  if (line.kind === 'proposalCollapsed') {
    return (
      <Text dimColor>
        <Text color={colorFor(line.speaker)}>▸ {line.speaker}</Text> proposal —{' '}
        {line.lines} lines (superseded)
      </Text>
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

function SpecSidebar({
  state,
  width,
  bodyRows,
}: {
  state: State;
  width: number;
  bodyRows: number;
}) {
  const { currentDraft, accepted, transcript } = state;
  const hasAccepted = accepted && currentDraft !== null;
  const innerWidth = Math.max(10, width - 4);
  // Header: "spec.md" + status line + optional "by proposer". Footer: "—" + "N turns".
  const headerRows = hasAccepted ? 3 : 2;
  const footerRows = 2;
  const bodyMax = Math.max(1, bodyRows - headerRows - footerRows);

  const bodyLines = hasAccepted
    ? wrapLines(currentDraft!.body, innerWidth)
    : [];
  const clipped = bodyLines.slice(0, bodyMax);
  const truncated = bodyLines.length > bodyMax;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      paddingX={1}
      width={width}
      flexShrink={0}
      overflow="hidden"
    >
      <Text bold>spec.md</Text>
      {hasAccepted ? (
        <>
          <Text color="green">✓ accepted</Text>
          <Text dimColor>by {currentDraft!.proposer}</Text>
          {clipped.map((l, i) => (
            <Text key={i}>{l}</Text>
          ))}
          {truncated && <Text dimColor>… (see spec.md)</Text>}
        </>
      ) : (
        <Text dimColor>
          {currentDraft
            ? '(nothing accepted yet — see draft.md)'
            : '(nothing accepted yet)'}
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
