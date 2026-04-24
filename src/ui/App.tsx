import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import type { Agent } from '../agents/agent.js';
import {
  startDebate,
  type DebateHandle,
  type DebateMode,
} from '../orchestrator/runner.js';
import { writeAcceptedSpec, clearSpec } from '../docs/spec.js';
import { writeDebate } from '../docs/debate.js';
import { writeDraft, clearDraft } from '../docs/draft.js';
import { writeDraftsHistory, type ProposalRecord } from '../docs/drafts.js';
import { writeExport } from '../docs/export.js';
import { copyToClipboard } from '../util/clipboard.js';
import { resolve as resolvePath } from 'node:path';
import type { State, TurnRecord } from '../orchestrator/types.js';
import { parseAgentOutput, type AgentOutput } from '../protocol/patch.js';
import { InputBox } from './InputBox.js';
import { parseSlashCommand } from './commands.js';
import { MarkdownLine, InlineText, visibleLength } from './markdown.js';
import type { ModelConfig } from './models.js';
import { SetupScreen } from './SetupScreen.js';
import { saveSetup } from './setup-store.js';

export type AppProps = {
  agents: { claude: Agent; codex: Agent };
  /** Initial prompt. If undefined or empty, App opens in prompt-entry mode. */
  prompt?: string;
  sessionName: string;
  rounds: number;
  mode?: DebateMode;
  /** Optional starting state from --resume. */
  initialState?: State;
  /** Where to save the prompt so future --resume runs can restore context. */
  promptSidecarPath?: string;
  transcriptPath: string;
  specPath: string;
  debatePath: string;
  draftPath: string;
  draftsPath: string;
  exportPath: string;
  onDone?: () => void;
  onQuit?: () => void;
  /** Test-only: skip prompt-entry view even when no initialState is set. */
  skipPromptEntry?: boolean;
  /**
   * When set, a model-picker view sits between prompt-entry and the debate.
   * Only relevant with real agent CLIs; fake mode skips the picker. The
   * factory is called with the user's final selections and replaces the
   * initial agents for the rest of the session.
   */
  buildAgents?: (config: ModelConfig) => { claude: Agent; codex: Agent };
  /** Defaults for the setup screen's Models field (from CLI flags + saved disk). */
  initialModelConfig?: ModelConfig;
  /**
   * Where to persist the setup-screen selection (mode + models). Omit to
   * disable persistence (tests). Also omitted in fake mode? No — we still
   * save so the next session remembers the user's preferences.
   */
  setupStorePath?: string;
};

export function App(props: AppProps) {
  const initialPrompt = (props.prompt ?? '').trim();
  const isResume =
    (props.initialState?.transcript?.length ?? 0) > 0 ||
    (props.initialState?.currentDraft ?? null) !== null;
  const showSetup = !isResume && !props.skipPromptEntry;
  const [phase, setPhase] = useState<'setup' | 'debate'>(
    showSetup ? 'setup' : 'debate',
  );
  const [activeAgents, setActiveAgents] = useState(props.agents);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [state, setState] = useState<State>(
    props.initialState ?? {
      speaker: 'idle',
      transcript: [],
      currentDraft: null,
      accepted: false,
    },
  );
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<string>('starting…');
  const [rounds, setRounds] = useState(props.rounds);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  const [paused, setPaused] = useState(false);
  const [usageTotals, setUsageTotals] = useState({
    // Running totals across all turns. `promptTokens` is the total prompt
    // size (uncached + cache-read + cache-creation). Cache-hit ratio is
    // cacheReadTokens / promptTokens.
    promptTokens: 0,
    cacheReadTokens: 0,
  });
  const [mode, setMode] = useState<DebateMode>(props.mode ?? 'auto');
  // Vim-style modal: start in scroll mode. Press `i` to enter insert/input.
  const [focusMode, setFocusMode] = useState<'input' | 'chat' | 'spec'>('chat');
  const [chatScroll, setChatScroll] = useState(0); // lines from tail; 0 = latest
  const [maxChatScroll, setMaxChatScroll] = useState(0);
  const [specScroll, setSpecScroll] = useState(0); // lines from top; 0 = top
  const [maxSpecScroll, setMaxSpecScroll] = useState(0);
  const [expandAll, setExpandAll] = useState(false);
  const pendingGRef = useRef(false); // two-key "gg" handler
  const lastScrollPaneRef = useRef<'chat' | 'spec'>('chat');
  const activeStartRef = useRef<number | null>(null);
  const handleRef = useRef<DebateHandle | null>(null);
  const pendingWritesRef = useRef<Promise<void>>(Promise.resolve());
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

  // Tab swaps between the two scroll panes (chat ↔ spec). In input mode
  // tab is a no-op — use `i`/Esc to move between insert and scroll.
  useInput((input, key) => {
    if (key.tab && focusMode !== 'input') {
      setFocusMode(f => (f === 'chat' ? 'spec' : 'chat'));
      pendingGRef.current = false;
      return;
    }
    // Ctrl+O toggles expand-all for superseded proposals, regardless of mode.
    if (key.ctrl && input === 'o') {
      setExpandAll(v => !v);
    }
  });

  // Vim-style scroll controls. Active in chat or spec scroll mode; routes to
  // the focused pane's scroll state. Chat uses tail-anchored offset (0 =
  // latest), spec uses top-anchored (0 = top).
  useInput(
    (input, key) => {
      if (input === 'i') {
        setFocusMode('input');
        pendingGRef.current = false;
        return;
      }
      const page = Math.max(1, Math.floor((dims.rows - 7) / 2));
      const isChat = focusMode === 'chat';
      const max = isChat ? maxChatScroll : maxSpecScroll;
      const setScroll = isChat ? setChatScroll : setSpecScroll;
      // Direction convention per pane: in chat, +offset scrolls up (older);
      // in spec, +offset scrolls down (further into the doc).
      const down = (delta: number) =>
        isChat
          ? setScroll(s => Math.max(0, s - delta))
          : setScroll(s => Math.min(max, s + delta));
      const up = (delta: number) =>
        isChat
          ? setScroll(s => Math.min(max, s + delta))
          : setScroll(s => Math.max(0, s - delta));
      if (input === 'j' || key.downArrow) {
        down(1);
        pendingGRef.current = false;
        return;
      }
      if (input === 'k' || key.upArrow) {
        up(1);
        pendingGRef.current = false;
        return;
      }
      if (key.ctrl && input === 'd') {
        down(page);
        pendingGRef.current = false;
        return;
      }
      if (key.ctrl && input === 'u') {
        up(page);
        pendingGRef.current = false;
        return;
      }
      if (input === 'G') {
        // G = bottom: for chat that's offset 0 (latest); for spec it's max.
        setScroll(isChat ? 0 : max);
        pendingGRef.current = false;
        return;
      }
      if (input === 'g') {
        if (pendingGRef.current) {
          // gg = top: for chat that's max (oldest); for spec it's 0.
          setScroll(isChat ? max : 0);
          pendingGRef.current = false;
        } else {
          pendingGRef.current = true;
        }
        return;
      }
      pendingGRef.current = false;
    },
    { isActive: focusMode === 'chat' || focusMode === 'spec' },
  );

  // Esc exits input mode back to the last-used scroll pane.
  useInput(
    (input, key) => {
      if (key.escape) {
        setFocusMode(lastScrollPaneRef.current);
      }
    },
    { isActive: focusMode === 'input' },
  );

  // Keep the "last scroll pane" memory in sync whenever the user lands on
  // one via any path (tab, h/l, startup).
  useEffect(() => {
    if (focusMode === 'chat' || focusMode === 'spec') {
      lastScrollPaneRef.current = focusMode;
    }
  }, [focusMode]);

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
    if (phase !== 'debate') return;
    if (props.promptSidecarPath && prompt) {
      // Persist the goal so a future --resume can restore per-turn context.
      import('node:fs/promises')
        .then(fs => fs.writeFile(props.promptSidecarPath!, prompt, 'utf8'))
        .catch(() => {});
    }
    const handle = startDebate({
      agents: activeAgents,
      prompt,
      rounds: props.rounds,
      mode,
      transcriptPath: props.transcriptPath,
      initialState: props.initialState,
      onPauseChange: p => setPaused(p),
      onUsage: (speaker, u) => {
        if (process.env.BRAMBLE_DEBUG_CACHE === '1') {
          console.error(
            `[bramble-cache] ${JSON.stringify({
              speaker,
              promptMode: u.promptMode,
              promptChars: u.promptChars,
              fullPromptChars: u.fullPromptChars,
              deltaPromptChars: u.deltaPromptChars,
              inputTokens: u.inputTokens,
              cacheReadTokens: u.cacheReadTokens,
              cacheCreationTokens: u.cacheCreationTokens,
              outputTokens: u.outputTokens,
            })}`,
          );
        }
        // Both agents' `TurnUsage.inputTokens` is normalized to mean
        // uncached-only (see codex-events.ts). Total prompt size for the
        // turn = inputTokens + cacheReadTokens + cacheCreationTokens.
        setUsageTotals(prev => ({
          promptTokens:
            prev.promptTokens +
            u.inputTokens +
            u.cacheReadTokens +
            u.cacheCreationTokens,
          cacheReadTokens: prev.cacheReadTokens + u.cacheReadTokens,
        }));
      },
      onState: next => {
        setState(next);
        const writes: Array<Promise<unknown>> = [
          writeDebate(
            props.debatePath,
            next.transcript.map(t => ({ speaker: t.speaker, content: t.content })),
          ),
        ];
        // draft.md = whatever is in-debate; spec.md = accepted only.
        if (next.accepted && next.currentDraft) {
          writes.push(writeAcceptedSpec(props.specPath, next.currentDraft.body));
          writes.push(clearDraft(props.draftPath));
        } else if (next.currentDraft) {
          writes.push(writeDraft(props.draftPath, next.currentDraft.body));
          writes.push(clearSpec(props.specPath));
        }
        pendingWritesRef.current = Promise.all([
          pendingWritesRef.current,
          ...writes,
        ]).then(() => undefined);
      },
    });
    handleRef.current = handle;

    handle.done
      .then(() => pendingWritesRef.current)
      .then(() => {
        setDone(true);
        setStatus('done');
        props.onDone?.();
      });

    return () => {
      handle.abort();
    };
  }, [phase]);

  const activeSpeaker = state.speaker;
  // 50/50 split between chat and spec sidebar.
  const sidebarWidth = Math.max(20, Math.floor(dims.columns / 2));
  const chatWidth = Math.max(20, dims.columns - sidebarWidth);
  // dims.rows minus: top header (1) + input box (3) + status row (1) + chat border (2) = 7
  const chatBodyRows = Math.max(4, dims.rows - 7);
  // chat interior after border (2) + paddingX (2)
  const chatInnerWidth = Math.max(10, chatWidth - 4);

  const elapsedMs =
    (activeSpeaker === 'claude' || activeSpeaker === 'codex') &&
    activeStartRef.current !== null
      ? now - activeStartRef.current
      : 0;

  const proposals = collectProposals(state);

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
              /* best-effort; never block session start on persistence */
            }
          }
          setStatus('starting…');
          setPhase('debate');
        }}
        onQuit={() => props.onQuit?.()}
      />
    );
  }

  const agentTurns = state.transcript.filter(
    t => t.speaker === 'claude' || t.speaker === 'codex',
  ).length;
  const currentRound = Math.min(
    rounds,
    Math.max(1, Math.floor(agentTurns / 2) + (done ? 0 : 1)),
  );

  return (
    <Box flexDirection="column" width={dims.columns} height={dims.rows}>
      <Box paddingX={1} flexShrink={0}>
        <Text>
          <Text color="greenBright" bold>
            ✦ bramble
          </Text>
          <Text dimColor> · </Text>
          <Text color="white">{props.sessionName}</Text>
          <Text dimColor> · </Text>
          <Text color={mode === 'auto' ? 'magenta' : 'yellow'}>{mode}</Text>
          <Text dimColor> · </Text>
          {done ? (
            <Text color="green">done</Text>
          ) : paused ? (
            <Text color="yellow">paused (enter to continue)</Text>
          ) : (
            <Text>
              <Text dimColor>speaker </Text>
              <Text color={colorFor(activeSpeaker as 'claude' | 'codex' | 'user')}>
                {activeSpeaker}
              </Text>
            </Text>
          )}
          <Text dimColor> · </Text>
          <Text>
            round {currentRound}/{rounds}
          </Text>
          {usageTotals.promptTokens > 0 && (
            <>
              <Text dimColor> · </Text>
              <Text dimColor>
                cache {Math.round((usageTotals.cacheReadTokens / usageTotals.promptTokens) * 100)}%
              </Text>
            </>
          )}
          <Text dimColor> · </Text>
          <Text dimColor>{status}</Text>
        </Text>
      </Box>
      <Box height={chatBodyRows + 2} flexShrink={0}>
        <ChatLog
          goal={prompt}
          transcript={state.transcript}
          activeSpeaker={activeSpeaker}
          elapsedMs={elapsedMs}
          expanded={expanded}
          expandAll={expandAll}
          scrollOffset={chatScroll}
          onMaxScrollChange={setMaxChatScroll}
          width={chatWidth}
          innerWidth={chatInnerWidth}
          bodyRows={chatBodyRows}
          focused={focusMode === 'chat'}
        />
        <SpecSidebar
          state={state}
          sessionName={props.sessionName}
          width={sidebarWidth}
          bodyRows={chatBodyRows}
          focused={focusMode === 'spec'}
          scrollOffset={specScroll}
          onMaxScrollChange={setMaxSpecScroll}
        />
      </Box>

      <Box
        borderStyle="single"
        borderColor={focusMode === 'input' ? 'magentaBright' : undefined}
        paddingX={1}
      >
        <InputBox
          disabled={focusMode !== 'input'}
          allowEmptySubmit={mode === 'collab'}
          onSubmit={line => {
            // Collab mode: empty enter = continue past the pause.
            if (mode === 'collab' && line.length === 0) {
              if (paused) {
                handleRef.current?.continue();
                setStatus('continuing…');
              }
              return;
            }
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
            if (cmd.kind === 'drafts') {
              void writeDraftsHistory(props.draftsPath, proposals);
              setStatus(`drafts → drafts.md (${proposals.length} proposal${
                proposals.length === 1 ? '' : 's'
              })`);
              return;
            }
            if (cmd.kind === 'export') {
              const target = cmd.filename
                ? resolvePath(process.cwd(), cmd.filename)
                : props.exportPath;
              void writeExport(target, {
                sessionName: props.sessionName,
                goal: prompt,
                state,
              }).then(
                () => setStatus(`exported → ${target}`),
                err => setStatus(`export failed: ${err.message ?? err}`),
              );
              return;
            }
            if (cmd.kind === 'copy') {
              const body = state.accepted && state.currentDraft
                ? state.currentDraft.body
                : null;
              if (!body) {
                setStatus('nothing to copy — no spec accepted yet');
                return;
              }
              void copyToClipboard(body).then(
                () => setStatus(`copied spec (${body.length} chars)`),
                err => setStatus(`copy failed: ${err.message ?? err}`),
              );
              return;
            }
            if (cmd.kind === 'expand') {
              if (!proposals.some(p => p.id === cmd.id)) {
                setStatus(`no proposal ${cmd.id}`);
                return;
              }
              setExpanded(prev => {
                const next = new Set(prev);
                if (next.has(cmd.id)) next.delete(cmd.id);
                else next.add(cmd.id);
                return next;
              });
              setStatus(`toggled ${cmd.id}`);
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
        <Text>
          {focusMode === 'input' ? (
            <Text color="green">-- INSERT --  esc: scroll</Text>
          ) : (
            <Text color="cyanBright">
              -- SCROLL {focusMode.toUpperCase()} --  j/k · gg/G · ctrl+d/u · tab: swap pane · i: type
            </Text>
          )}
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
  /** Stable id for a proposal-bearing turn, e.g. "claude-1". */
  proposalId?: string;
  /** True if the user has toggled this proposal open via /expand. */
  proposalExpanded?: boolean;
};

function ChatLog({
  goal,
  transcript,
  activeSpeaker,
  elapsedMs,
  expanded,
  expandAll,
  scrollOffset,
  onMaxScrollChange,
  width,
  innerWidth,
  bodyRows,
  focused,
}: {
  goal: string;
  transcript: TurnRecord[];
  activeSpeaker: State['speaker'];
  elapsedMs: number;
  expanded: Set<string>;
  expandAll: boolean;
  scrollOffset: number;
  onMaxScrollChange: (max: number) => void;
  width: number;
  innerWidth: number;
  bodyRows: number;
  focused: boolean;
}) {
  const parsedTurns = transcript.map(t => {
    const res = parseAgentOutput(t.content, { fallbackToCommentary: true });
    return { turn: t, parsed: res.ok ? res.value : undefined };
  });
  const lastProposalIdxBySpeaker: Record<string, number> = {};
  const proposalCounter: Record<string, number> = { claude: 0, codex: 0 };
  const proposalIds: Record<number, string> = {};
  parsedTurns.forEach((pt, i) => {
    if (pt.parsed?.proposal && (pt.turn.speaker === 'claude' || pt.turn.speaker === 'codex')) {
      lastProposalIdxBySpeaker[pt.turn.speaker] = i;
      proposalCounter[pt.turn.speaker]! += 1;
      proposalIds[i] = `${pt.turn.speaker}-${proposalCounter[pt.turn.speaker]}`;
    }
  });

  const items: ChatItem[] = parsedTurns.map((pt, i) => {
    const id = proposalIds[i];
    const superseded =
      pt.parsed?.proposal != null && lastProposalIdxBySpeaker[pt.turn.speaker] !== i;
    return {
      speaker: pt.turn.speaker,
      content: pt.parsed?.commentary ?? pt.turn.content,
      parsed: pt.parsed,
      proposalSuperseded: superseded,
      proposalId: id,
      proposalExpanded: expandAll || (id ? expanded.has(id) : false),
    };
  });
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
  const { lines, atTop, atBottom, totalLines } = tailChatLines(
    items,
    innerWidth,
    availableRows,
    scrollOffset,
  );
  const maxOffset = Math.max(0, totalLines - availableRows);
  useEffect(() => {
    onMaxScrollChange(maxOffset);
  }, [maxOffset, onMaxScrollChange]);
  const goalLine = truncateOneLine(`goal: ${goal}`, innerWidth);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={focused ? 'cyanBright' : undefined}
      paddingX={1}
      width={width}
      flexShrink={0}
      overflow="hidden"
    >
      <Text bold color="blue">
        {goalLine}
        {!atTop && <Text color="yellow">{'  '}▲ more above</Text>}
        {!atBottom && <Text color="yellow">{'  '}▼ more below</Text>}
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
  | { kind: 'proposalCodeRow'; text: string }
  | { kind: 'proposalBottom'; text: string }
  | {
      kind: 'proposalCollapsed';
      speaker: 'claude' | 'codex';
      lines: number;
      id: string;
    }
  | { kind: 'verdict'; speaker: 'claude' | 'codex'; verdict: 'LGTM' | 'counter' };

const PROPOSAL_SUMMARY_LINES = 6;

function tailChatLines(
  items: ChatItem[],
  width: number,
  maxLines: number,
  scrollOffset: number,
): { lines: RenderLine[]; atTop: boolean; atBottom: boolean; totalLines: number } {
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
      const collapsed =
        item.proposalSuperseded === true && item.proposalExpanded !== true;

      if (collapsed) {
        all.push({
          kind: 'proposalCollapsed',
          speaker: item.speaker,
          lines: totalLines,
          id: item.proposalId ?? `${item.speaker}-?`,
        });
      } else {
        const expandedFull = item.proposalExpanded === true;
        const boxWidth = Math.max(20, width);
        const innerCap = Math.max(4, boxWidth - 4);

        // ┌── <speaker> proposal [id] ───...───┐
        const label = item.proposalId
          ? ` ${item.speaker} proposal ${item.proposalId} `
          : ` ${item.speaker} proposal `;
        const topLead = `──${label}`;
        const topFill = '─'.repeat(Math.max(0, boxWidth - 2 - topLead.length));
        all.push({
          kind: 'proposalTop',
          speaker: item.speaker,
          text: `┌${topLead}${topFill}┐`,
        });

        const previewCount = expandedFull ? totalLines : PROPOSAL_SUMMARY_LINES;
        const rawLines = body.split('\n').slice(0, previewCount);
        const wrapped: Array<{ text: string; code: boolean }> = [];
        let inFence = false;
        for (const bodyLine of rawLines) {
          if (/^\s*```/.test(bodyLine)) {
            inFence = !inFence;
            continue; // don't render the fence marker itself
          }
          if (bodyLine.length === 0) {
            wrapped.push({ text: '', code: inFence });
          } else {
            for (const w of wrapLines(bodyLine, innerCap)) {
              wrapped.push({ text: w, code: inFence });
            }
          }
        }
        if (!expandedFull && totalLines > PROPOSAL_SUMMARY_LINES) {
          const id = item.proposalId ?? '';
          const hint = id
            ? ` (/expand ${id} · ctrl+o all · draft.md)`
            : ' (ctrl+o expand all · draft.md)';
          wrapped.push({
            text: `… +${totalLines - PROPOSAL_SUMMARY_LINES} more${hint}`,
            code: false,
          });
        }
        for (const w of wrapped) {
          const padded = (w.text + ' '.repeat(innerCap)).slice(0, innerCap);
          all.push({
            kind: w.code ? 'proposalCodeRow' : 'proposalRow',
            text: padded,
          });
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
  const total = all.length;
  const maxOffset = Math.max(0, total - maxLines);
  const clamped = Math.min(Math.max(0, scrollOffset), maxOffset);
  const end = total - clamped;
  const start = Math.max(0, end - maxLines);
  return {
    lines: all.slice(start, end),
    atTop: start === 0,
    atBottom: clamped === 0,
    totalLines: total,
  };
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
  if (line.kind === 'cont') return <Text><InlineText text={line.text} /></Text>;
  if (line.kind === 'label') {
    return (
      <Text>
        <Text color={colorFor(line.speaker)} bold>
          {line.labelText}
        </Text>
        <InlineText text={line.bodyText} />
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
    const trimmed = line.text.replace(/\s+$/, '');
    // After markdown rendering, **bold**/`code`/etc. occupy fewer columns than
    // raw chars — pad based on visible width, not string length, so the right
    // │ lands in the correct column.
    const visible = visibleLength(trimmed);
    const pad = ' '.repeat(Math.max(0, line.text.length - visible));
    return (
      <Text>
        <Text dimColor>│ </Text>
        <MarkdownLine line={trimmed} />
        {pad}
        <Text dimColor> │</Text>
      </Text>
    );
  }
  if (line.kind === 'proposalCodeRow') {
    return (
      <Text>
        <Text dimColor>│ </Text>
        <Text backgroundColor="#1c1f26" color="cyan">
          {line.text}
        </Text>
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
        <Text color={colorFor(line.speaker)}>▸ {line.id}</Text> — {line.lines}{' '}
        lines (superseded, /expand {line.id} or ctrl+o)
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
  sessionName,
  width,
  bodyRows,
  focused,
  scrollOffset,
  onMaxScrollChange,
}: {
  state: State;
  sessionName: string;
  width: number;
  bodyRows: number;
  focused: boolean;
  scrollOffset: number;
  onMaxScrollChange: (max: number) => void;
}) {
  const { currentDraft, accepted, transcript } = state;
  const hasAccepted = accepted && currentDraft !== null;
  const innerWidth = Math.max(10, width - 4);
  // Header: title + status line + optional "by proposer". Footer: "—" + "N turns".
  const headerRows = hasAccepted ? 3 : 2;
  const footerRows = 2;
  const bodyMax = Math.max(1, bodyRows - headerRows - footerRows);

  const bodyLines: Array<{ text: string; code: boolean }> = [];
  if (hasAccepted) {
    let inFence = false;
    for (const raw of currentDraft!.body.split('\n')) {
      if (/^\s*```/.test(raw)) {
        inFence = !inFence;
        continue;
      }
      if (raw.length === 0) {
        bodyLines.push({ text: '', code: inFence });
      } else {
        for (const w of wrapLines(raw, innerWidth)) {
          bodyLines.push({ text: w, code: inFence });
        }
      }
    }
  }
  const maxOffset = Math.max(0, bodyLines.length - bodyMax);
  useEffect(() => {
    onMaxScrollChange(maxOffset);
  }, [maxOffset, onMaxScrollChange]);
  const start = Math.min(Math.max(0, scrollOffset), maxOffset);
  const clipped = bodyLines.slice(start, start + bodyMax);
  const atTop = start === 0;
  const atBottom = start >= maxOffset;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={focused ? 'cyanBright' : undefined}
      paddingX={1}
      width={width}
      flexShrink={0}
      overflow="hidden"
    >
      <Text bold>
        spec-{sessionName}.md
        {hasAccepted && !atTop && <Text color="yellow">{'  '}▲</Text>}
        {hasAccepted && !atBottom && <Text color="yellow">{'  '}▼</Text>}
      </Text>
      {hasAccepted ? (
        <>
          <Text color="green">✓ accepted</Text>
          <Text dimColor>by {currentDraft!.proposer}</Text>
          {clipped.map((l, i) =>
            l.code ? (
              <Text key={i} backgroundColor="#1c1f26" color="cyan">
                {(l.text + ' '.repeat(innerWidth)).slice(0, innerWidth)}
              </Text>
            ) : (
              <MarkdownLine key={i} line={l.text} />
            ),
          )}
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

function collectProposals(state: State): ProposalRecord[] {
  const out: ProposalRecord[] = [];
  const counter: Record<string, number> = { claude: 0, codex: 0 };
  for (const turn of state.transcript) {
    if (turn.speaker !== 'claude' && turn.speaker !== 'codex') continue;
    const res = parseAgentOutput(turn.content, { fallbackToCommentary: true });
    if (!res.ok || !res.value.proposal) continue;
    counter[turn.speaker]! += 1;
    out.push({
      id: `${turn.speaker}-${counter[turn.speaker]}`,
      speaker: turn.speaker,
      body: res.value.proposal.body,
      accepted: false,
    });
  }
  // Mark the latest proposal as accepted if state.accepted and matches the draft.
  if (state.accepted && state.currentDraft && out.length > 0) {
    const last = out[out.length - 1]!;
    if (last.body === state.currentDraft.body) last.accepted = true;
  }
  return out;
}

function commentaryOf(raw: string): string {
  const parsed = parseAgentOutput(raw, { fallbackToCommentary: true });
  return parsed.ok ? parsed.value.commentary : raw;
}

function colorFor(speaker: 'claude' | 'codex' | 'user'): string {
  return speaker === 'claude' ? 'cyan' : speaker === 'codex' ? 'magenta' : 'yellow';
}
