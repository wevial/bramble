import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type SessionRow = {
  name: string;
  turns: number;
  goal: string;
  accepted: boolean;
  mtime: Date;
};

/**
 * Scan `dir` for `transcript-<name>.jsonl` files and return one row per
 * session, newest transcript first. Pairs each transcript with its
 * prompt/spec sidecars when present.
 */
export async function listSessions(dir: string): Promise<SessionRow[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const names = entries
    .map(f => /^transcript-(.+)\.jsonl$/.exec(f)?.[1])
    .filter((n): n is string => typeof n === 'string');

  const rows: SessionRow[] = [];
  for (const name of names) {
    const transcriptPath = join(dir, `transcript-${name}.jsonl`);
    const promptPath = join(dir, `prompt-${name}.txt`);
    const specPath = join(dir, `spec-${name}.md`);

    const [turns, goal, accepted, mtime] = await Promise.all([
      countLines(transcriptPath),
      readFileSafe(promptPath).then(t => t.trim()),
      exists(specPath).then(e => e && hasContent(specPath)),
      stat(transcriptPath).then(s => s.mtime).catch(() => new Date(0)),
    ]);

    rows.push({ name, turns, goal, accepted: Boolean(accepted), mtime });
  }
  rows.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return rows;
}

async function countLines(path: string): Promise<number> {
  const raw = await readFileSafe(path);
  if (raw.length === 0) return 0;
  return raw.split('\n').filter(l => l.length > 0).length;
}

async function readFileSafe(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function hasContent(path: string): Promise<boolean> {
  const s = await readFileSafe(path);
  return s.trim().length > 0;
}
