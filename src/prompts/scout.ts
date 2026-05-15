import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type RepoContextFile = {
  path: string;
  bytes: number;
  content: string;
};

export type RepoContext = {
  cwd: string;
  files: RepoContextFile[];
  topLevel: string[];
};

const CANONICAL_FILES = [
  'README.md',
  'CLAUDE.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'package.json',
];

const MAX_FILE_BYTES = 32 * 1024;
const MAX_TOPLEVEL_ENTRIES = 80;

export function probeRepoContext(cwd: string): RepoContext {
  const files: RepoContextFile[] = [];
  for (const name of CANONICAL_FILES) {
    const full = join(cwd, name);
    if (!existsSync(full)) continue;
    let content: string;
    let bytes: number;
    try {
      const raw = readFileSync(full, 'utf8');
      bytes = Buffer.byteLength(raw, 'utf8');
      content = raw.length > MAX_FILE_BYTES ? raw.slice(0, MAX_FILE_BYTES) + '\n\n[truncated]' : raw;
    } catch {
      continue;
    }
    files.push({ path: name, bytes, content });
  }

  let topLevel: string[] = [];
  try {
    topLevel = readdirSync(cwd)
      .filter(n => !n.startsWith('.'))
      .slice(0, MAX_TOPLEVEL_ENTRIES)
      .map(n => {
        try {
          return statSync(join(cwd, n)).isDirectory() ? `${n}/` : n;
        } catch {
          return n;
        }
      })
      .sort();
  } catch {
    topLevel = [];
  }

  return { cwd, files, topLevel };
}

export function renderRepoContext(ctx: RepoContext): string {
  if (ctx.files.length === 0 && ctx.topLevel.length === 0) return '';
  const parts: string[] = [];
  parts.push(`Working directory: ${ctx.cwd}`);
  if (ctx.topLevel.length > 0) {
    parts.push(`Top-level entries:\n${ctx.topLevel.join('  ')}`);
  }
  for (const f of ctx.files) {
    parts.push(`## ${f.path}\n\n${f.content}`);
  }
  return parts.join('\n\n');
}
