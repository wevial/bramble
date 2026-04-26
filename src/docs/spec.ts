import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

/**
 * spec.md is the canonical living spec body. It's overwritten on every
 * debate turn that lands an edit; the transcript holds the per-turn audit
 * trail. Empty file means "no spec yet" (interview phase or zero edits).
 */
export async function writeSpec(path: string, body: string): Promise<void> {
  await writeFile(path, body, 'utf8');
}

export async function readSpec(path: string): Promise<string> {
  if (!existsSync(path)) return '';
  return readFile(path, 'utf8');
}
