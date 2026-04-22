import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export async function writeDraft(path: string, body: string): Promise<void> {
  await writeFile(path, body, 'utf8');
}

export async function clearDraft(path: string): Promise<void> {
  await writeFile(path, '', 'utf8');
}

export async function readDraft(path: string): Promise<string> {
  if (!existsSync(path)) return '';
  return readFile(path, 'utf8');
}
