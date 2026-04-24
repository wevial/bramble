import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type SessionRow = {
  name: string;
  turns: number;
  goal: string;
  accepted: boolean;
  mtime: Date;
};

export type SessionPaths = {
  root: string;
  dir: string;
  transcriptPath: string;
  specPath: string;
  debatePath: string;
  draftPath: string;
  draftsPath: string;
  promptPath: string;
};

/**
 * Compute all artifact paths for a session given the root store (e.g.
 * `./.bramble/`) and a session name. Filenames are bare (no per-session
 * prefix) since the directory scopes them.
 */
export function sessionPaths(root: string, name: string): SessionPaths {
  const dir = join(root, name);
  return {
    root,
    dir,
    transcriptPath: join(dir, 'transcript.jsonl'),
    specPath: join(dir, 'spec.md'),
    debatePath: join(dir, 'debate.md'),
    draftPath: join(dir, 'draft.md'),
    draftsPath: join(dir, 'drafts.md'),
    promptPath: join(dir, 'prompt.txt'),
  };
}

/**
 * Scan `root` for subdirectories containing a `transcript.jsonl` and
 * return one row per session, newest transcript first. Pairs each
 * transcript with its prompt/spec sidecars when present.
 */
export async function listSessions(root: string): Promise<SessionRow[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const rows: SessionRow[] = [];
  for (const name of entries) {
    const p = sessionPaths(root, name);
    if (!(await exists(p.transcriptPath))) continue;

    const [turns, goal, accepted, mtime] = await Promise.all([
      countLines(p.transcriptPath),
      readFileSafe(p.promptPath).then(t => t.trim()),
      hasContent(p.specPath),
      stat(p.transcriptPath).then(s => s.mtime).catch(() => new Date(0)),
    ]);

    rows.push({ name, turns, goal, accepted, mtime });
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
