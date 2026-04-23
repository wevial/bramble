import { describe, it, expect } from 'vitest';
import { streamProcessLines } from './subprocess.js';

describe('streamProcessLines', () => {
  it('yields each stdout line from a short-lived process', async () => {
    const lines: string[] = [];
    const signal = new AbortController().signal;
    for await (const line of streamProcessLines(
      { cmd: 'sh', args: ['-c', 'printf "one\\ntwo\\nthree\\n"'] },
      signal,
    )) {
      lines.push(line);
    }
    expect(lines).toEqual(['one', 'two', 'three']);
  });

  it('terminates the process when the signal aborts', async () => {
    const ac = new AbortController();
    const iter = streamProcessLines(
      { cmd: 'sh', args: ['-c', 'for i in $(seq 1 1000); do echo $i; sleep 0.05; done'] },
      ac.signal,
    );
    const received: string[] = [];
    setTimeout(() => ac.abort(), 80);
    for await (const line of iter) {
      received.push(line);
      if (received.length > 100) break;
    }
    expect(received.length).toBeGreaterThan(0);
    expect(received.length).toBeLessThan(50);
  });

  it('throws on nonzero exit, surfacing stderr', async () => {
    const signal = new AbortController().signal;
    let caught: Error | null = null;
    try {
      for await (const _line of streamProcessLines(
        { cmd: 'sh', args: ['-c', 'echo "boom" >&2; exit 2'] },
        signal,
      )) {
        // no-op
      }
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('exited with code 2');
    expect(caught!.message).toContain('boom');
  });

  it('throws when the command is not found', async () => {
    const signal = new AbortController().signal;
    let caught: Error | null = null;
    try {
      for await (const _line of streamProcessLines(
        { cmd: '/no/such/command/zzz', args: [] },
        signal,
      )) {
        // no-op
      }
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/failed to spawn|exited with code/);
  });

  it('handles lines larger than the default chunk boundary', async () => {
    const big = 'x'.repeat(5000);
    const lines: string[] = [];
    const signal = new AbortController().signal;
    for await (const line of streamProcessLines(
      { cmd: 'sh', args: ['-c', `printf "${big}\\n"`] },
      signal,
    )) {
      lines.push(line);
    }
    expect(lines).toEqual([big]);
  });
});
