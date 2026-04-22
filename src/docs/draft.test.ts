import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDraft, clearDraft, readDraft } from './draft.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bramble-draft-'));
  file = join(dir, 'draft.md');
});

describe('draft.md', () => {
  it('writeDraft creates the file with the current in-debate body', async () => {
    expect(existsSync(file)).toBe(false);
    await writeDraft(file, '# Auth\n\nemail + pw');
    expect(readFileSync(file, 'utf8')).toBe('# Auth\n\nemail + pw');
  });

  it('writeDraft replaces earlier content', async () => {
    await writeDraft(file, 'v1 body');
    await writeDraft(file, 'v2 body');
    expect(readFileSync(file, 'utf8')).toBe('v2 body');
  });

  it('clearDraft empties the file', async () => {
    await writeDraft(file, 'something');
    await clearDraft(file);
    expect(readFileSync(file, 'utf8')).toBe('');
    expect(existsSync(file)).toBe(true);
  });

  it('readDraft returns empty when file does not exist', async () => {
    expect(await readDraft(file)).toBe('');
  });
});
