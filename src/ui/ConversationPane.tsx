import React, { useEffect, useRef } from 'react';
import { createTextAttributes } from '@opentui/core';
import type { ScrollBoxRenderable } from '@opentui/core';
import type { State } from '../orchestrator/state.js';
import type { PersonaId } from '../personas/personas.js';
import { findPersona } from '../personas/personas.js';
import { InlineText } from './markdown.js';

type Entry =
  | { kind: 'user'; content: string; timestamp: string }
  | {
      kind: 'agent';
      speaker: PersonaId;
      commentary: string;
      question: string | null;
      ready: boolean;
      timestamp: string;
    }
  | {
      kind: 'debate';
      speaker: PersonaId;
      commentary: string;
      verdict: 'continue' | 'lgtm';
      applied: number;
      rejected: number;
      charsChanged: number;
      round: number;
      timestamp: string;
    }
  | { kind: 'divider'; label: string; timestamp: string };

function isSpecialist(id: PersonaId): boolean {
  return findPersona(id)?.scope === 'specialist';
}

const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });

export function buildConversation(state: State): Entry[] {
  const out: Entry[] = [];
  for (const t of state.interview) {
    // Specialists only render an interview turn when they actually contribute
    // a question or commentary. Pure "ready" beats are silent in the feed.
    if (isSpecialist(t.speaker) && !t.question && !t.commentary.trim()) {
      continue;
    }
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
    // Specialists with no commentary and no edits are silent here too.
    if (
      isSpecialist(d.speaker) &&
      !d.commentary.trim() &&
      d.applied.length === 0
    ) {
      continue;
    }
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

  // Insert a divider where the conversation transitions from interview to
  // spec drafting (first debate turn).
  const firstDebateIdx = out.findIndex(e => e.kind === 'debate');
  if (firstDebateIdx >= 0) {
    out.splice(firstDebateIdx, 0, {
      kind: 'divider',
      label: 'Spec drafting',
      timestamp: out[firstDebateIdx]!.timestamp,
    });
  }
  return out;
}

function formatTime(ts: string): string {
  // HH:MM:SS in local time, falling back to the raw string if unparseable.
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function speakerColor(id: PersonaId): string {
  return findPersona(id)?.color ?? 'white';
}

function speakerLabel(id: PersonaId): string {
  return findPersona(id)?.label ?? id;
}

function speakerGlyph(id: PersonaId): string {
  return findPersona(id)?.glyph ?? '·';
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
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  // OpenTUI's stickyScroll engages stickiness only while the user hasn't
  // manually scrolled. Once content grows or layout reflows it can stop
  // pinning to the bottom. Force-scroll on every state change so new turns
  // are always visible — the user can still scroll up between updates,
  // but the next turn will jump them back to the latest.
  useEffect(() => {
    const sb = scrollRef.current;
    if (!sb) return;
    sb.scrollTo({ x: 0, y: sb.scrollHeight });
  });

  if (slice.length === 0) {
    const speaker = state.speaker;
    const placeholder =
      speaker === 'idle'
        ? 'Waiting for the first turn…'
        : `${speakerLabel(speaker)} is starting up…`;
    return (
      <box flexDirection="column" paddingX={1} flexGrow={1}>
        <text><span fg="cyan" attributes={BOLD}>CONVERSATION</span></text>
        <box height={1} />
        <scrollbox ref={scrollRef} flexGrow={1} stickyScroll stickyStart="bottom" scrollY>
          <text><span attributes={DIM}>{placeholder}</span></text>
        </scrollbox>
      </box>
    );
  }

  return (
    <box flexDirection="column" paddingX={1} flexGrow={1}>
      <text><span fg="cyan" attributes={BOLD}>CONVERSATION</span></text>
      <box height={1} />
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" scrollY>
        <box flexDirection="column">
        {slice.map((e, i) => {
          if (e.kind === 'divider') {
            return (
              <box key={i} flexDirection="row" marginBottom={1} flexShrink={0}>
                <text>
                  <span attributes={DIM}>───── </span>
                  <span fg="cyan" attributes={BOLD}>{e.label}</span>
                  <span attributes={DIM}> ─────</span>
                </text>
              </box>
            );
          }
          return (
            <box key={i} flexDirection="column" marginBottom={1} flexShrink={0}>
              {renderHeader(e)}
              {renderBody(e)}
            </box>
          );
        })}
        {state.speaker !== 'idle' &&
        state.speaker !== 'user' &&
        !state.endReason ? (
          <box flexDirection="column">
            <text>
              <span attributes={DIM}>
              {speakerLabel(state.speaker)} is{' '}
              {state.phase === 'interview' ? 'thinking…' : 'drafting…'}
              </span>
            </text>
            {state.lastModeratorReason ? (
              <text>
                <span attributes={DIM}>  ↳ moderator: {state.lastModeratorReason}</span>
              </text>
            ) : null}
          </box>
        ) : null}
        </box>
      </scrollbox>
    </box>
  );
}

function renderHeader(e: Exclude<Entry, { kind: 'divider' }>): React.ReactNode {
  const ts = formatTime(e.timestamp);
  if (e.kind === 'user') {
    return (
      <text>
        <span fg="brightGreen">✦ </span>
        <span fg="brightGreen" attributes={BOLD}>You</span>
        <span attributes={DIM}> · {ts}</span>
      </text>
    );
  }
  const color = speakerColor(e.speaker);
  const label = speakerLabel(e.speaker);
  const glyph = `${speakerGlyph(e.speaker)} `;
  const glyphColor = color;
  return (
    <text>
      <span fg={glyphColor}>{glyph}</span>
      <span fg={color} attributes={BOLD}>{label}</span>
      <span attributes={DIM}> · {ts}</span>
      {e.kind === 'agent' && e.ready ? (
        <span fg="green"> · ready</span>
      ) : null}
      {e.kind === 'debate' ? (
        <span>
          <span attributes={DIM}> · r{e.round}</span>
          <span fg={e.verdict === 'lgtm' ? 'green' : 'yellow'}>
            {' '}
            · {e.verdict}
          </span>
          {e.applied > 0 ? (
            <span attributes={DIM}>
              {' '}
              · {e.applied} edit{e.applied === 1 ? '' : 's'} ({e.charsChanged}
              c)
            </span>
          ) : null}
          {e.rejected > 0 ? (
            <span fg="red"> · {e.rejected} rejected</span>
          ) : null}
        </span>
      ) : null}
    </text>
  );
}

function renderBody(e: Exclude<Entry, { kind: 'divider' }>): React.ReactNode {
  if (e.kind === 'user') {
    return <text>{e.content}</text>;
  }
  return (
    <>
      {e.commentary ? (
        <text>
          <InlineText text={e.commentary} />
        </text>
      ) : null}
      {e.kind === 'agent' && e.question ? (
        <text><span fg="yellow">? {e.question}</span></text>
      ) : null}
    </>
  );
}
