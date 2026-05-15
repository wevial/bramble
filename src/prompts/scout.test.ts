import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeRepoContext, renderRepoContext } from './scout.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scout-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('probeRepoContext', () => {
  it('returns empty files/topLevel for an empty dir', () => {
    const ctx = probeRepoContext(dir);
    expect(ctx.cwd).toBe(dir);
    expect(ctx.files).toEqual([]);
    expect(ctx.topLevel).toEqual([]);
  });

  it('reads canonical files when present', () => {
    writeFileSync(join(dir, 'README.md'), '# Hello\n');
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}');
    const ctx = probeRepoContext(dir);
    const paths = ctx.files.map(f => f.path).sort();
    expect(paths).toEqual(['README.md', 'package.json']);
    expect(ctx.files.find(f => f.path === 'README.md')?.content).toContain('# Hello');
  });

  it('lists top-level dirs with trailing slash', () => {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'index.ts'), '');
    const ctx = probeRepoContext(dir);
    expect(ctx.topLevel).toEqual(['index.ts', 'src/']);
  });

  it('skips dotfiles in the top-level listing', () => {
    writeFileSync(join(dir, '.env'), 'SECRET=1');
    writeFileSync(join(dir, 'README.md'), '# hi');
    const ctx = probeRepoContext(dir);
    expect(ctx.topLevel).not.toContain('.env');
    expect(ctx.topLevel).toContain('README.md');
  });

  it('truncates very large canonical files', () => {
    const big = 'x'.repeat(64 * 1024);
    writeFileSync(join(dir, 'README.md'), big);
    const ctx = probeRepoContext(dir);
    const readme = ctx.files.find(f => f.path === 'README.md');
    expect(readme).toBeDefined();
    expect(readme!.content.endsWith('[truncated]')).toBe(true);
    expect(readme!.content.length).toBeLessThan(big.length);
  });

  it('skips canonical files that do not exist', () => {
    writeFileSync(join(dir, 'README.md'), '# only one');
    const ctx = probeRepoContext(dir);
    expect(ctx.files.map(f => f.path)).toEqual(['README.md']);
  });
});

describe('renderRepoContext', () => {
  it('returns empty string when nothing was found', () => {
    expect(renderRepoContext({ cwd: '/tmp', files: [], topLevel: [] })).toBe('');
  });

  it('includes cwd, top-level entries, and file bodies', () => {
    const out = renderRepoContext({
      cwd: '/repo',
      files: [{ path: 'README.md', bytes: 10, content: '# hi' }],
      topLevel: ['src/', 'package.json'],
    });
    expect(out).toContain('Working directory: /repo');
    expect(out).toContain('Top-level entries:');
    expect(out).toContain('src/');
    expect(out).toContain('## README.md');
    expect(out).toContain('# hi');
  });
});
