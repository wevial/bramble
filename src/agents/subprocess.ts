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

  let stderr = '';
  let exitCode: number | null = null;
  let spawnErrorMessage: string | null = null;

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
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.on('close', code => {
    exitCode = code;
    if (buffer.length > 0) queue.push(buffer);
    queue.push(null);
    wake();
  });
  child.on('error', err => {
    spawnErrorMessage = (err as Error).message;
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
      if (next === null) break;
      yield next;
    }
    if (spawnErrorMessage) {
      throw new Error(
        `failed to spawn \`${spec.cmd}\`: ${spawnErrorMessage}`,
      );
    }
    if (!signal.aborted && exitCode !== null && exitCode !== 0) {
      const tail = stderr.trim().split('\n').slice(-3).join(' · ');
      throw new Error(
        `\`${spec.cmd}\` exited with code ${exitCode}${
          tail ? `: ${tail}` : ''
        }`,
      );
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (!child.killed) child.kill('SIGTERM');
  }
}
