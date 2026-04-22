import { appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { TurnRecord } from '../orchestrator/types.js';

export async function appendTurn(path: string, record: TurnRecord): Promise<void> {
  await appendFile(path, JSON.stringify(record) + '\n', 'utf8');
}

export async function readTranscript(path: string): Promise<TurnRecord[]> {
  if (!existsSync(path)) return [];
  const raw = await readFile(path, 'utf8');
  return raw
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as TurnRecord);
}
