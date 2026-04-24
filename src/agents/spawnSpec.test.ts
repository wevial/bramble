import { describe, it, expect } from 'vitest';
import { claudeSpawnSpec } from './claude.js';
import { codexSpawnSpec } from './codex.js';

describe('claudeSpawnSpec', () => {
  it('builds base args with stream-json output and the prompt', () => {
    const spec = claudeSpawnSpec('hello');
    expect(spec.cmd).toBe('claude');
    expect(spec.args).toEqual([
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ]);
    expect(spec.cwd).toBeUndefined();
  });

  it('appends --model when pinned', () => {
    const spec = claudeSpawnSpec('x', { model: 'claude-haiku-4-5' });
    expect(spec.args).toContain('--model');
    expect(spec.args).toContain('claude-haiku-4-5');
  });

  it('threads cwd when isolated', () => {
    const spec = claudeSpawnSpec('x', { cwd: '/tmp/iso-abc' });
    expect(spec.cwd).toBe('/tmp/iso-abc');
  });
});

describe('codexSpawnSpec', () => {
  it('builds exec --json args with the prompt last', () => {
    const spec = codexSpawnSpec('hello');
    expect(spec.cmd).toBe('codex');
    expect(spec.args).toEqual(['exec', '--json', 'hello']);
    expect(spec.cwd).toBeUndefined();
  });

  it('appends -m and reasoning-effort when set', () => {
    const spec = codexSpawnSpec('x', {
      model: 'gpt-5.4-mini',
      reasoningEffort: 'low',
    });
    expect(spec.args).toContain('-m');
    expect(spec.args).toContain('gpt-5.4-mini');
    expect(spec.args.join(' ')).toContain('model_reasoning_effort=low');
  });

  it('threads cwd when isolated', () => {
    const spec = codexSpawnSpec('x', { cwd: '/tmp/iso-xyz' });
    expect(spec.cwd).toBe('/tmp/iso-xyz');
  });

  it('keeps the prompt as the final positional arg even with flags', () => {
    const spec = codexSpawnSpec('my prompt', {
      model: 'gpt-5.4-mini',
      reasoningEffort: 'low',
    });
    expect(spec.args[spec.args.length - 1]).toBe('my prompt');
  });
});
