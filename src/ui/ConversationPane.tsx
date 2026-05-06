import React from 'react';
import { Box, Text } from 'ink';
import type { State } from '../orchestrator/state.js';
import { InlineText } from './markdown.js';

type Entry =
  | { kind: 'user'; content: string; timestamp: string }
  | {
      kind: 'agent';
      speaker: 'claude' | 'codex';
      commentary: string;
      question: string | null;
      ready: boolean;
      timestamp: string;
    }
  | {
      kind: 'debate';
      speaker: 'claude' | 'codex';
      commentary: string;
      verdict: 'continue' | 'lgtm';
      applied: number;
      rejected: number;
      charsChanged: number;
      round: number;
      timestamp: string;
    };

export function buildConversation(state: State): Entry[] {
  const out: Entry[] = [];
  for (const t of state.interview) {
    out.push({
      kind: 'agent',
      speaker: t.speaker,
      commentary: t.commentary,
      question: t.question,
      ready: t.ready,
      timestamp: t.timestamp,
    });
  }
  for (const a of state.userAnswers) {
    out.push({ kind: 'user', content: a.content, timestamp: a.timestamp });
  }
  for (const d of state.debate) {
    out.push({
      kind: 'debate',
      speaker: d.speaker,
      commentary: d.commentary,
      verdict: d.verdict,
      applied: d.applied.length,
      rejected: d.rejected.length,
      charsChanged: d.charsChanged,
      round: d.round,
      timestamp: d.timestamp,
    });
  }
  out.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return out;
}

function formatTime(ts: string): string {
  // HH:MM:SS in local time, falling back to the raw string if unparseable.
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function speakerColor(s: 'claude' | 'codex'): string {
  return s === 'claude' ? '#FF8C42' : 'cyan';
}

function speakerLabel(s: 'claude' | 'codex'): string {
  return s === 'claude' ? 'Claude' : 'Codex';
}

export function ConversationPane({
  state,
  maxEntries = 8,
}: {
  state: State;
  maxEntries?: number;
}) {
  const all = buildConversation(state);
  const slice = all.slice(-maxEntries);

  if (slice.length === 0) {
    const speaker = state.speaker;
    const placeholder =
      speaker === 'idle'
        ? 'Waiting for the first turn…'
        : `${speakerLabel(speaker as 'claude' | 'codex')} is starting up…`;
    return (
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        <Text bold color="cyan">CONVERSATION</Text>
        <Box height={1} />
        <Box flexDirection="column" flexGrow={1} justifyContent="flex-end">
          <Text dimColor>{placeholder}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Text bold color="cyan">CONVERSATION</Text>
      <Box height={1} />
      <Box flexDirection="column" flexGrow={1} justifyContent="flex-end">
        {slice.map((e, i) => (
          <Box key={i} flexDirection="column" marginBottom={1} flexShrink={0}>
            {renderHeader(e)}
            {renderBody(e)}
          </Box>
        ))}
        {(state.speaker === 'claude' || state.speaker === 'codex') &&
        !state.endReason ? (
          <Text dimColor>
            {speakerLabel(state.speaker)} is{' '}
            {state.phase === 'interview' ? 'thinking…' : 'drafting…'}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}

function renderHeader(e: Entry): React.ReactNode {
  const ts = formatTime(e.timestamp);
  if (e.kind === 'user') {
    return (
      <Text>
        <Text color="greenBright">✦ </Text>
        <Text color="greenBright" bold>You</Text>
        <Text dimColor> · {ts}</Text>
      </Text>
    );
  }
  const color = speakerColor(e.speaker);
  const label = speakerLabel(e.speaker);
  const glyph = e.speaker === 'claude' ? '☀ ' : '⊛ ';
  const glyphColor = e.speaker === 'claude' ? '#FF8C42' : 'cyan';
  return (
    <Text>
      <Text color={glyphColor}>{glyph}</Text>
      <Text color={color} bold>{label}</Text>
      <Text dimColor> · {ts}</Text>
      {e.kind === 'agent' && e.ready ? (
        <Text color="green"> · ready</Text>
      ) : null}
      {e.kind === 'debate' ? (
        <Text>
          <Text dimColor> · r{e.round}</Text>
          <Text color={e.verdict === 'lgtm' ? 'green' : 'yellow'}>
            {' '}
            · {e.verdict}
          </Text>
          {e.applied > 0 ? (
            <Text dimColor>
              {' '}
              · {e.applied} edit{e.applied === 1 ? '' : 's'} ({e.charsChanged}
              c)
            </Text>
          ) : null}
          {e.rejected > 0 ? (
            <Text color="red"> · {e.rejected} rejected</Text>
          ) : null}
        </Text>
      ) : null}
    </Text>
  );
}

function renderBody(e: Entry): React.ReactNode {
  if (e.kind === 'user') {
    return <Text>{e.content}</Text>;
  }
  return (
    <>
      {e.commentary ? (
        <Text>
          <InlineText text={e.commentary} />
        </Text>
      ) : null}
      {e.kind === 'agent' && e.question ? (
        <Text color="yellow">? {e.question}</Text>
      ) : null}
    </>
  );
}
