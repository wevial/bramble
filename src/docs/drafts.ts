import { writeFile } from 'node:fs/promises';

export type ProposalRecord = {
  id: string;
  speaker: 'claude' | 'codex';
  body: string;
  accepted: boolean;
};

export async function writeDraftsHistory(
  path: string,
  proposals: ProposalRecord[],
): Promise<void> {
  if (proposals.length === 0) {
    await writeFile(path, '', 'utf8');
    return;
  }
  const blocks = proposals.map(p => {
    const tag = p.accepted ? ' (accepted)' : '';
    return `## ${p.id}${tag}\n\n${p.body}`;
  });
  await writeFile(path, blocks.join('\n\n---\n\n') + '\n', 'utf8');
}
