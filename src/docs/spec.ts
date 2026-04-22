import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { Speaker } from '../orchestrator/types.js';

export type SpecTurn = { speaker: Speaker; content: string };

export async function appendSpecTurn(path: string, turn: SpecTurn): Promise<void> {
  const block = `## ${turn.speaker}\n\n${turn.content}\n\n`;
  await appendFile(path, block, 'utf8');
}

export async function readSpec(path: string): Promise<string> {
  if (!existsSync(path)) return '';
  return readFile(path, 'utf8');
}

export async function clearSpec(path: string): Promise<void> {
  await writeFile(path, '', 'utf8');
}
