import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSavedSetup, saveSetup, type SavedSetup } from './setup-store.js';

function freshFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bramble-setup-'));
  return join(dir, 'setup.json');
}

describe('setup-store', () => {
  it('returns null when the file does not exist', () => {
    expect(loadSavedSetup(join(tmpdir(), 'does-not-exist-bramble-setup.json'))).toBeNull();
  });

  it('round-trips a full setup object', () => {
    const path = freshFile();
    const saved: SavedSetup = {
      mode: 'collab',
      claudeModel: 'claude-sonnet-4-6',
      claudeEffort: 'high',
      codexModel: 'gpt-5.4',
      codexEffort: 'medium',
    };
    saveSetup(path, saved);
    expect(loadSavedSetup(path)).toEqual(saved);
  });

  it('ignores unknown fields and keeps known nulls', () => {
    const path = freshFile();
    writeFileSync(
      path,
      JSON.stringify({
        mode: 'auto',
        claudeModel: null,
        claudeEffort: 'high',
        surprise: 'ignored',
      }),
    );
    expect(loadSavedSetup(path)).toEqual({
      mode: 'auto',
      claudeModel: null,
      claudeEffort: 'high',
    });
  });

  it('returns null on malformed JSON', () => {
    const path = freshFile();
    writeFileSync(path, '{ not json');
    expect(loadSavedSetup(path)).toBeNull();
  });

  it('returns null when the top-level value is not an object', () => {
    const path = freshFile();
    writeFileSync(path, '"hello"');
    expect(loadSavedSetup(path)).toBeNull();
  });

  it('rejects values with the wrong type', () => {
    const path = freshFile();
    writeFileSync(path, JSON.stringify({ mode: 'turbo', claudeEffort: 42 }));
    // Unknown mode and non-string effort are dropped; rest of the shape still loads.
    expect(loadSavedSetup(path)).toEqual({});
  });

  it('creates the parent directory on save', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bramble-setup-'));
    const path = join(dir, 'nested', 'deep', 'setup.json');
    saveSetup(path, { mode: 'auto' });
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ mode: 'auto' });
  });
});
