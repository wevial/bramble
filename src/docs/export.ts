import { writeFile } from 'node:fs/promises';
import type { State } from '../orchestrator/types.js';
import { parseAgentOutput } from '../protocol/patch.js';

export type ExportInput = {
  sessionName: string;
  goal: string;
  state: State;
};

/**
 * Render a session into a single shareable markdown document: title,
 * goal, final accepted spec (or a placeholder), and the full debate
 * transcript. Pure for testability — use writeExport to persist.
 */
export function buildExport(input: ExportInput): string {
  const { sessionName, goal, state } = input;
  const lines: string[] = [];
  lines.push(`# ${sessionName}`);
  lines.push('');
  lines.push(`**Goal:** ${goal}`);
  lines.push('');
  lines.push('## Spec');
  lines.push('');
  if (state.accepted && state.currentDraft) {
    lines.push(`*Accepted — proposed by ${state.currentDraft.proposer}*`);
    lines.push('');
    lines.push(state.currentDraft.body);
  } else {
    lines.push('*No spec accepted yet.*');
  }
  lines.push('');
  lines.push('## Debate transcript');
  lines.push('');
  if (state.transcript.length === 0) {
    lines.push('*(empty)*');
  } else {
    for (const t of state.transcript) {
      let body = t.content;
      if (t.speaker === 'claude' || t.speaker === 'codex') {
        const parsed = parseAgentOutput(t.content, { fallbackToCommentary: true });
        if (parsed.ok && parsed.value.commentary) body = parsed.value.commentary;
      }
      lines.push(`### ${t.speaker}`);
      lines.push('');
      lines.push(body);
      lines.push('');
    }
  }
  return lines.join('\n').trimEnd() + '\n';
}

export async function writeExport(path: string, input: ExportInput): Promise<void> {
  await writeFile(path, buildExport(input), 'utf8');
}
