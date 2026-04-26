import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { DebateTurn } from '../orchestrator/state.js';

/**
 * debate.md is a per-turn ledger of agent commentary + the edits they
 * proposed (applied or rejected). Useful for postmortem; the transcript is
 * the source of truth.
 */
export async function writeDebateLedger(
  path: string,
  turns: DebateTurn[],
): Promise<void> {
  const body = turns.map(renderTurn).join('\n\n---\n\n');
  await writeFile(path, body + (body ? '\n' : ''), 'utf8');
}

function renderTurn(t: DebateTurn): string {
  const out: string[] = [
    `## ${t.speaker} · round ${t.round} · ${t.verdict}`,
    '',
    t.commentary,
  ];
  if (t.applied.length > 0) {
    out.push('', `**applied (${t.applied.length}):**`);
    for (const e of t.applied) {
      out.push('', editBlock(e));
    }
  }
  if (t.rejected.length > 0) {
    out.push('', `**rejected (${t.rejected.length}):**`);
    for (const r of t.rejected) {
      out.push('', `- ${r.kind} (${r.count} matches)`, editBlock(r.edit));
    }
  }
  return out.join('\n');
}

function editBlock(e: { find: string; replace: string }): string {
  return [
    '```diff',
    ...e.find.split('\n').map(l => '- ' + l),
    ...e.replace.split('\n').map(l => '+ ' + l),
    '```',
  ].join('\n');
}

export async function readDebateLedger(path: string): Promise<string> {
  if (!existsSync(path)) return '';
  return readFile(path, 'utf8');
}
