import { spawn } from 'node:child_process';

export type SpawnSpec = {
  cmd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

/**
 * Spawn a process and yield each line of stdout as it arrives. Respects
 * the given AbortSignal — aborting sends SIGTERM and closes the iterator.
 */
export async function* streamProcessLines(
  spec: SpawnSpec,
  signal: AbortSignal,
): AsyncGenerator<string, void, void> {
  const child = spawn(spec.cmd, spec.args, {
    env: spec.env ?? process.env,
    cwd: spec.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const onAbort = () => {
    if (!child.killed) child.kill('SIGTERM');
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });

  const queue: (string | null)[] = [];
  let resolveWaiter: (() => void) | null = null;
  const wake = () => {
    if (resolveWaiter) {
      const r = resolveWaiter;
      resolveWaiter = null;
      r();
    }
  };

  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      queue.push(line);
      nl = buffer.indexOf('\n');
    }
    wake();
  });
  child.on('close', () => {
    if (buffer.length > 0) queue.push(buffer);
    queue.push(null);
    wake();
  });
  child.on('error', () => {
    queue.push(null);
    wake();
  });

  try {
    while (true) {
      if (queue.length === 0) {
        await new Promise<void>(resolve => {
          resolveWaiter = resolve;
        });
        continue;
      }
      const next = queue.shift()!;
      if (next === null) return;
      yield next;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (!child.killed) child.kill('SIGTERM');
  }
}
