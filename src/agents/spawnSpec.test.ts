import { describe, it, expect } from 'vitest';
import { claudeTransportArgs } from './claude-transport.js';
import { codexSpawnSpec } from './codex.js';

describe('claudeTransportArgs (long-lived)', () => {
  it('opens stream-json on both input and output so one process spans the debate', () => {
    const args = claudeTransportArgs({});
    expect(args.slice(0, 7)).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ]);
    // No positional prompt — the transport feeds each turn over stdin.
    expect(args).not.toContain('hello');
  });

  it('passes --exclude-dynamic-system-prompt-sections to stabilize the cached system prefix', () => {
    expect(claudeTransportArgs({})).toContain(
      '--exclude-dynamic-system-prompt-sections',
    );
  });

  it('appends --append-system-prompt when given', () => {
    const args = claudeTransportArgs({ appendSystemPrompt: 'DEBATE RULES' });
    const i = args.indexOf('--append-system-prompt');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('DEBATE RULES');
  });

  it('threads --model and --effort', () => {
    const args = claudeTransportArgs({
      model: 'claude-haiku-4-5',
      reasoningEffort: 'high',
    });
    expect(args).toContain('--model');
    expect(args).toContain('claude-haiku-4-5');
    expect(args).toContain('--effort');
    expect(args).toContain('high');
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
