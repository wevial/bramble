import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSpec, writeSpec } from './spec.js';

let tmp: string;
let path: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bramble-spec-'));
  path = join(tmp, 'spec.md');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('spec.ts', () => {
  it('writes the body verbatim', async () => {
    await writeSpec(path, '# Spec\n\n## Goals\nDraft.');
    expect(readFileSync(path, 'utf8')).toBe('# Spec\n\n## Goals\nDraft.');
  });

  it('overwrites a prior body fully (no append semantics)', async () => {
    await writeSpec(path, 'first');
    await writeSpec(path, 'second');
    expect(readFileSync(path, 'utf8')).toBe('second');
  });

  it('readSpec returns "" for a nonexistent file', async () => {
    expect(await readSpec(path)).toBe('');
  });

  it('roundtrips empty body', async () => {
    await writeSpec(path, '');
    expect(await readSpec(path)).toBe('');
  });
});
