import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

/**
 * A ClaudeTransport owns one long-lived `claude -p` subprocess per debate, so
 * the CLI sees a real growing conversation over stdin (one JSONL user message
 * per turn) instead of a fresh process per turn. The goal is to let Claude
 * Code / Anthropic prompt caching apply to the debate history across turns,
 * not just to the CLI's own static system context.
 *
 * Turns are strictly sequential — one `runTurn` at a time. An in-flight turn
 * can be aborted; doing so kills the process (losing that turn's cache). The
 * next `runTurn` will transparently spawn a fresh process.
 */
export interface ClaudeTransport {
  /**
   * Send a user message and yield each JSONL line from stdout until the
   * turn's terminating `type: "result"` line (inclusive).
   */
  runTurn(promptText: string, signal: AbortSignal): AsyncIterable<string>;
  /**
   * Generation counter for the underlying child process. Increments every
   * time a new child is spawned (including silent respawns after crashes
   * between turns). ClaudeAgent uses this to detect session loss and fall
   * back to a full prompt instead of a delta.
   */
  sessionGeneration(): number;
  /**
   * The generation under which the most recently started turn ran. Captured
   * at turn start so it isn't affected by a `close` bump that fires after
   * the turn's `result` but before the caller reads back. Returns the same
   * value as `sessionGeneration()` before any turn has started.
   */
  lastTurnGeneration(): number;
  /** Kill the underlying process (if any) and release resources. */
  dispose(): void;
}

export type ClaudeTransportOptions = {
  model?: string;
  reasoningEffort?: string;
  cwd?: string;
  /** Appended to the CLI's default system prompt — stable across the session. */
  appendSystemPrompt?: string;
};

export function claudeTransportArgs(opts: ClaudeTransportOptions): string[] {
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    // Move per-machine context (cwd, env, memory) out of the cached system
    // prompt so the cacheable prefix is as stable as possible across turns.
    '--exclude-dynamic-system-prompt-sections',
  ];
  if (opts.appendSystemPrompt) {
    args.push('--append-system-prompt', opts.appendSystemPrompt);
  }
  if (opts.model) args.push('--model', opts.model);
  if (opts.reasoningEffort) args.push('--effort', opts.reasoningEffort);
  return args;
}

export function encodeUserMessage(text: string): string {
  return (
    JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text }],
      },
    }) + '\n'
  );
}

/**
 * Inspect a raw stdout line: does it mark the end of a turn? We treat any
 * `type: "result"` line as terminal (success or error).
 */
export function isTurnTerminatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return false;
  }
  return (
    typeof obj === 'object' &&
    obj !== null &&
    (obj as { type?: unknown }).type === 'result'
  );
}

/** The real transport — spawns `claude` with stream-json I/O. */
export function createClaudeTransport(
  opts: ClaudeTransportOptions,
): ClaudeTransport {
  type QueueItem =
    | { kind: 'line'; value: string }
    | { kind: 'end'; error: Error | null };

  let child: ChildProcessWithoutNullStreams | null = null;
  let disposed = false;
  let generation = 0;
  let turnGeneration = 0;
  let turnLock: Promise<void> = Promise.resolve();

  let queue: QueueItem[] = [];
  let waiter: (() => void) | null = null;
  const wake = () => {
    if (waiter) {
      const r = waiter;
      waiter = null;
      r();
    }
  };

  const ensureChild = () => {
    if (child && !child.killed && child.exitCode === null) return;
    generation++;
    queue = [];
    const args = claudeTransportArgs(opts);
    const c = spawn('claude', args, {
      env: process.env,
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderrBuf = '';
    let buffer = '';
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        queue.push({ kind: 'line', value: buffer.slice(0, nl) });
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
      wake();
    });
    c.stderr.setEncoding('utf8');
    c.stderr.on('data', (chunk: string) => {
      stderrBuf += chunk;
    });
    c.on('close', code => {
      if (buffer.length > 0) {
        queue.push({ kind: 'line', value: buffer });
        buffer = '';
      }
      const err =
        code === 0 || code === null
          ? null
          : new Error(
              `claude exited with code ${code}${
                stderrBuf
                  ? `: ${stderrBuf.trim().split('\n').slice(-3).join(' · ')}`
                  : ''
              }`,
            );
      queue.push({ kind: 'end', error: err });
      child = null;
      // Bump generation now — not just when the next child spawns — so that
      // ClaudeAgent's pre-runTurn check already sees the session as lost.
      generation++;
      wake();
    });
    c.on('error', spawnErr => {
      queue.push({
        kind: 'end',
        error: new Error(`failed to spawn \`claude\`: ${(spawnErr as Error).message}`),
      });
      child = null;
      generation++;
      wake();
    });
    child = c;
  };

  const runTurn = (
    promptText: string,
    signal: AbortSignal,
  ): AsyncIterable<string> =>
    (async function* () {
      // Serialize turns once the iterable is consumed. This avoids wedging the
      // transport if a caller creates an iterable and never pulls from it.
      let release!: () => void;
      const prior = turnLock;
      turnLock = new Promise<void>(r => {
        release = r;
      });

      await prior;
      try {
        if (disposed) return;
        if (signal.aborted) return;

        ensureChild();
        const active = child;
        if (!active) return;
        // Snapshot the generation this turn is running under, before any
        // `close` handler could bump the counter. ClaudeAgent reads this
        // back after the turn to decide whether its session is still alive.
        turnGeneration = generation;

        const onAbort = () => {
          // Kill the process — the next turn will spawn a fresh one.
          if (active && !active.killed) active.kill('SIGTERM');
        };
        signal.addEventListener('abort', onAbort, { once: true });

        try {
          active.stdin.write(encodeUserMessage(promptText));
        } catch {
          signal.removeEventListener('abort', onAbort);
          return;
        }

        try {
          while (true) {
            if (signal.aborted) return;
            if (queue.length === 0) {
              await new Promise<void>(resolve => {
                waiter = resolve;
              });
              continue;
            }
            const next = queue.shift()!;
            if (next.kind === 'end') {
              if (next.error && !signal.aborted) throw next.error;
              return;
            }
            yield next.value;
            if (isTurnTerminatorLine(next.value)) return;
          }
        } finally {
          signal.removeEventListener('abort', onAbort);
        }
      } finally {
        release();
      }
    })();

  return {
    runTurn,
    sessionGeneration() {
      return generation;
    },
    lastTurnGeneration() {
      return turnGeneration;
    },
    dispose() {
      disposed = true;
      const c = child;
      child = null;
      if (c && !c.killed) {
        try {
          c.stdin.end();
        } catch {
          /* ignore */
        }
        c.kill('SIGTERM');
      }
    },
  };
}
