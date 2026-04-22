import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDraftsHistory } from './drafts.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bramble-drafts-'));
  file = join(dir, 'drafts.md');
});

describe('writeDraftsHistory', () => {
  it('renders each proposal with a header and divider', async () => {
    await writeDraftsHistory(file, [
      { id: 'claude-1', speaker: 'claude', body: '# v1', accepted: false },
      { id: 'claude-2', speaker: 'claude', body: '# v2', accepted: true },
    ]);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('## claude-1');
    expect(text).toContain('# v1');
    expect(text).toContain('## claude-2');
    expect(text).toContain('# v2');
    expect(text).toContain('(accepted)');
  });

  it('writes an empty file when there are no proposals', async () => {
    await writeDraftsHistory(file, []);
    expect(readFileSync(file, 'utf8')).toBe('');
  });
});
