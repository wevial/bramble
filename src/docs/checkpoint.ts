import { writeFile } from 'node:fs/promises';
import type { DebateTurn, State } from '../orchestrator/state.js';
import type { Persona, PersonaId } from '../personas/personas.js';

/**
 * checkpoint.md is the curated end-of-session artifact: where the raw logs
 * (debate.md, transcript.jsonl) record every turn, the checkpoint
 * synthesizes the decision journey — what was decided, who pushed back on
 * what, what got deferred, and what to do next. It's the document you paste
 * into a PR description or hand to an implementing agent.
 *
 * Deliberately pure rendering over final state: no LLM call, so it's
 * deterministic, free, and safe to regenerate on every session end.
 */

/** Commentary lines that signal deferred / follow-up work. */
const DEFERRAL_PATTERN =
  /\b(defer(?:red|ring)?|v2|future|follow[- ]?up|out of scope|revisit|post[- ]?launch|later release)\b/i;

/** Spec headings whose sections carry open/deferred items verbatim. */
const OPEN_SECTION_PATTERN =
  /^(open questions?|out of scope|deferred|future work|next steps?|risks?)$/i;

export function generateCheckpoint(state: State, personas: Persona[]): string {
  const lines: string[] = [];
  const label = (id: PersonaId): string =>
    personas.find(p => p.id === id)?.label ?? id;

  const goal = state.prompt.trim().split('\n')[0] ?? '';
  lines.push(`# Checkpoint — ${goal}`, '');

  // ── Session summary ────────────────────────────────────────────────
  const ended = lastTimestamp(state);
  const meta: string[] = [];
  meta.push(`- **Outcome:** ${describeEnd(state)}`);
  meta.push(
    `- **Debate:** ${state.debate.length} turns over ${state.round} round${state.round === 1 ? '' : 's'}`,
  );
  meta.push(
    `- **Participants:** ${(state.activePersonas ?? []).map(label).join(', ')}`,
  );
  if (state.interview.length > 0) {
    meta.push(
      `- **Interview:** ${state.interview.length} agent turns, ${state.userAnswers.length} user answers`,
    );
  }
  if (ended) meta.push(`- **Last activity:** ${ended}`);
  lines.push(...meta, '');

  // ── Spec at a glance ───────────────────────────────────────────────
  const outline = specOutline(state.spec);
  if (outline.length > 0) {
    lines.push('## Spec at a glance', '');
    lines.push(
      `${state.spec.length.toLocaleString()} chars · sections:`,
      '',
      ...outline.map(h => `- ${h}`),
      '',
    );
  }

  // ── Success criteria ───────────────────────────────────────────────
  if (state.criteria.length > 0) {
    lines.push('## Success criteria', '');
    lines.push(
      'Approved during setup — use as the verification checklist:',
      '',
      ...state.criteria.map(c => `- [ ] ${c}`),
      '',
    );
  }

  // ── Decision journey ───────────────────────────────────────────────
  if (state.debate.length > 0) {
    lines.push('## Decision journey', '');
    lines.push('| Round | Speaker | Verdict | Δ chars | Note |');
    lines.push('|---|---|---|---|---|');
    for (const t of state.debate) {
      lines.push(
        `| ${t.round} | ${label(t.speaker)} | ${t.verdict} | ${t.charsChanged} | ${excerpt(t.commentary)} |`,
      );
    }
    lines.push('');
  }

  // ── Voices ─────────────────────────────────────────────────────────
  const voices = summarizeVoices(state, personas);
  if (voices.length > 0) {
    lines.push('## Voices', '');
    for (const v of voices) {
      lines.push(`### ${v.label}${v.scope === 'specialist' ? ' (specialist)' : ''}`, '');
      lines.push(
        `${v.turns} turn${v.turns === 1 ? '' : 's'} · ${v.applied} edits applied · ${v.rejected} rejected · final verdict: ${v.finalVerdict}`,
      );
      if (v.lastSubstantive) {
        lines.push('', `> ${v.lastSubstantive}`);
      }
      lines.push('');
    }
  }

  // ── Deferred & open items ──────────────────────────────────────────
  const deferred = collectDeferred(state);
  if (deferred.length > 0) {
    lines.push('## Deferred & open items', '');
    lines.push(...deferred.map(d => `- ${d}`), '');
  }

  return lines.join('\n');
}

export async function writeCheckpoint(
  path: string,
  state: State,
  personas: Persona[],
): Promise<void> {
  await writeFile(path, generateCheckpoint(state, personas), 'utf8');
}

function describeEnd(state: State): string {
  switch (state.endReason) {
    case 'mutual_lgtm':
      return 'consensus — every primary signed off (mutual LGTM)';
    case 'max_rounds':
      return `round cap reached (${state.config.maxRounds}) without consensus`;
    case 'edit_decay':
      return 'converged — edit volume decayed below the change threshold';
    case 'user_done':
      return 'closed by the user (/done)';
    case undefined:
      return state.phase === 'done'
        ? 'session ended'
        : `session still in ${state.phase} phase`;
  }
}

function lastTimestamp(state: State): string | null {
  const stamps = [
    ...state.debate.map(t => t.timestamp),
    ...state.interview.map(t => t.timestamp),
    ...state.userAnswers.map(a => a.timestamp),
  ].filter(Boolean);
  if (stamps.length === 0) return null;
  return stamps.reduce((a, b) => (a > b ? a : b));
}

/** Top-two-level headings of the spec, indented to show nesting. */
function specOutline(spec: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of spec.split('\n')) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,3})\s+(.*)/.exec(line);
    if (!m) continue;
    const depth = m[1]!.length;
    out.push(`${'  '.repeat(Math.max(0, depth - 1))}${m[2]!.trim()}`);
  }
  return out;
}

/** First sentence-ish of a commentary, table-cell safe. */
function excerpt(text: string, max = 90): string {
  const firstLine = text.trim().split('\n')[0] ?? '';
  const clipped =
    firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine;
  return clipped.replace(/\|/g, '\\|');
}

type Voice = {
  label: string;
  scope: 'primary' | 'specialist';
  turns: number;
  applied: number;
  rejected: number;
  finalVerdict: string;
  lastSubstantive: string | null;
};

function summarizeVoices(state: State, personas: Persona[]): Voice[] {
  const voices: Voice[] = [];
  for (const id of state.activePersonas ?? []) {
    const persona = personas.find(p => p.id === id);
    const turns = state.debate.filter(t => t.speaker === id);
    if (turns.length === 0) continue;
    const last = turns[turns.length - 1]!;
    // The most recent commentary with actual content — an LGTM turn often
    // says only "lgtm", which isn't worth quoting.
    const lastSubstantive =
      [...turns]
        .reverse()
        .map(t => t.commentary.trim())
        .find(c => c.length > 20) ?? null;
    voices.push({
      label: persona?.label ?? id,
      scope: persona?.scope ?? 'primary',
      turns: turns.length,
      applied: turns.reduce((n, t) => n + t.applied.length, 0),
      rejected: turns.reduce((n, t) => n + t.rejected.length, 0),
      finalVerdict: last.verdict,
      lastSubstantive:
        lastSubstantive === null ? null : excerpt(lastSubstantive, 220),
    });
  }
  return voices;
}

/**
 * Deferral candidates from two sources: commentary lines that used
 * deferral language during the debate, and spec sections whose headings
 * mark open/deferred content (those bullets are included verbatim).
 */
function collectDeferred(state: State): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (item: string, source: string) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(`${item} _(${source})_`);
  };

  for (const t of state.debate) {
    for (const line of t.commentary.split('\n')) {
      const trimmed = line.replace(/^[-*>\s]+/, '').trim();
      if (trimmed.length < 15 || trimmed.length > 300) continue;
      if (DEFERRAL_PATTERN.test(trimmed)) {
        add(trimmed, `${t.speaker}, round ${t.round}`);
      }
    }
  }

  for (const section of openSections(state.spec)) {
    for (const line of section.body.split('\n')) {
      const m = /^\s*[-*]\s+(.*)/.exec(line);
      if (m && m[1]!.trim().length > 0) add(m[1]!.trim(), 'spec');
    }
  }
  return out;
}

function openSections(spec: string): { heading: string; body: string }[] {
  const sections: { heading: string; body: string }[] = [];
  const lines = spec.split('\n');
  let current: { heading: string; body: string[] } | null = null;
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) inFence = !inFence;
    const m = !inFence && /^#{1,3}\s+(.*)/.exec(line);
    if (m) {
      if (current) {
        sections.push({ heading: current.heading, body: current.body.join('\n') });
      }
      current = OPEN_SECTION_PATTERN.test(m[1]!.trim())
        ? { heading: m[1]!.trim(), body: [] }
        : null;
      continue;
    }
    current?.body.push(line);
  }
  if (current) {
    sections.push({ heading: current.heading, body: current.body.join('\n') });
  }
  return sections;
}
