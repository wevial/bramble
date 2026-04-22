import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { Speaker } from '../orchestrator/types.js';

export type DebateEntry = { speaker: Speaker; content: string };

export async function writeDebate(path: string, entries: DebateEntry[]): Promise<void> {
  const body = entries
    .map(e => `## ${e.speaker}\n\n${e.content}\n`)
    .join('\n');
  await writeFile(path, body, 'utf8');
}

export async function readDebate(path: string): Promise<string> {
  if (!existsSync(path)) return '';
  return readFile(path, 'utf8');
}

export async function clearDebate(path: string): Promise<void> {
  await writeFile(path, '', 'utf8');
}
