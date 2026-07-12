import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { type OutputFormat, formatExtension, OUTPUT_FORMATS } from '../docs/format.js';

export type SessionRow = {
  name: string;
  turns: number;
  goal: string;
  accepted: boolean;
  /**
   * First transcript entry's timestamp — when the session actually started.
   * Null for empty transcripts or legacy lines without a parseable timestamp.
   */
  created: Date | null;
  /**
   * Last transcript entry's timestamp — the last real event, immune to
   * cp/rsync/checkout clobbering. Falls back to fs mtime when unparseable.
   */
  updated: Date;
};

export type SessionPaths = {
  root: string;
  dir: string;
  transcriptPath: string;
  specPath: string;
  debatePath: string;
  interviewPath: string;
  promptPath: string;
  checkpointPath: string;
};

/**
 * Compute all artifact paths for a session given the root store (e.g.
 * `./.bramble/`) and a session name. Filenames are bare (no per-session
 * prefix) since the directory scopes them.
 */
export function sessionPaths(
  root: string,
  name: string,
  specFormat: OutputFormat = 'md',
): SessionPaths {
  const dir = join(root, name);
  return {
    root,
    dir,
    transcriptPath: join(dir, 'transcript.jsonl'),
    specPath: join(dir, `spec.${formatExtension(specFormat)}`),
    debatePath: join(dir, 'debate.md'),
    interviewPath: join(dir, 'interview.md'),
    promptPath: join(dir, 'prompt.txt'),
    checkpointPath: join(dir, 'checkpoint.md'),
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

    const [transcript, goal, accepted, mtime] = await Promise.all([
      readFileSafe(p.transcriptPath),
      readFileSafe(p.promptPath).then(t => t.trim()),
      hasAnySpec(p.dir),
      stat(p.transcriptPath).then(s => s.mtime).catch(() => new Date(0)),
    ]);

    const lines = transcript.split('\n').filter(l => l.length > 0);
    const created = lines.length > 0 ? entryTimestamp(lines[0]!) : null;
    const updated =
      (lines.length > 0 ? entryTimestamp(lines[lines.length - 1]!) : null) ??
      mtime;

    rows.push({ name, turns: lines.length, goal, accepted, created, updated });
  }
  rows.sort((a, b) => b.updated.getTime() - a.updated.getTime());
  return rows;
}

/**
 * Pull the timestamp out of one transcript line. Most entries carry a
 * top-level `timestamp`; turn entries nest it under `turn.timestamp`.
 */
function entryTimestamp(line: string): Date | null {
  try {
    const obj = JSON.parse(line) as {
      timestamp?: unknown;
      turn?: { timestamp?: unknown };
    };
    const ts = obj.timestamp ?? obj.turn?.timestamp;
    if (typeof ts !== 'string') return null;
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
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

/** Check all possible spec file extensions so --list works for any format. */
async function hasAnySpec(dir: string): Promise<boolean> {
  try {
    await Promise.any(
      OUTPUT_FORMATS.map(fmt =>
        hasContent(join(dir, `spec.${formatExtension(fmt)}`)).then(ok => {
          if (!ok) throw new Error();
        }),
      ),
    );
    return true;
  } catch {
    return false;
  }
}

/** Detect which output format was used for an existing session. */
export async function detectSessionFormat(dir: string): Promise<OutputFormat | null> {
  for (const fmt of OUTPUT_FORMATS) {
    if (fmt === 'md') continue;
    if (await exists(join(dir, `spec.${formatExtension(fmt)}`))) return fmt;
  }
  if (await exists(join(dir, 'spec.md'))) return 'md';
  return null;
}
