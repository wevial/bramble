import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { CodexTransport } from './codex.js';
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  killWithGrace,
  startIdleWatchdog,
  withTimeout,
} from './idle-timeout.js';

/**
 * Persistent `codex app-server` transport. One long-lived JSON-RPC (v2)
 * process per debate holds a single thread across turns, eliminating the
 * per-turn CLI cold start that `codex exec … resume <id>` pays and keeping
 * the server-side conversation cache warm.
 *
 * Emitted lines are translated into the `codex exec --json` event shapes
 * (`item.completed` / `turn.completed`) so `parseCodexEvent` in CodexAgent
 * works unchanged. A bonus over exec: `item/agentMessage/delta`
 * notifications stream real token deltas, so Codex output renders
 * incrementally instead of arriving as one block.
 *
 * Session-loss semantics mirror ClaudeTransport: aborting a turn or a
 * process crash kills the child and bumps the generation counter; the next
 * turn transparently respawns and starts a fresh thread, and CodexAgent's
 * generation check makes it fall back to a full prompt.
 */

export type AppServerTransportOptions = {
  model?: string;
  reasoningEffort?: string;
  cwd?: string;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /**
   * Kill the child and fail the turn if it emits no notifications for this
   * long during an in-flight turn (also bounds the spawn handshake).
   * <= 0 disables. Default 5 minutes.
   */
  idleTimeoutMs?: number;
};

type JsonRpcMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
};

/** Translate one app-server notification into an exec-style JSONL line. */
export function translateNotification(
  method: string,
  params: Record<string, unknown>,
  state: { deltaItems: Set<string>; lastUsage: TokenUsageLast | null },
): { line?: string; done?: boolean; error?: string } {
  if (method === 'item/agentMessage/delta') {
    if (typeof params.delta !== 'string') return {};
    const itemId = typeof params.itemId === 'string' ? params.itemId : '';
    // Only mark the item as streamed when we actually emitted its text, so
    // a malformed delta still falls back to item/completed's full text.
    state.deltaItems.add(itemId);
    return {
      line: JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: params.delta },
      }),
    };
  }
  if (method === 'item/completed') {
    const item = params.item as Record<string, unknown> | undefined;
    if (
      item &&
      item.type === 'agentMessage' &&
      typeof item.text === 'string' &&
      // Skip if this item already streamed via deltas — avoid double text.
      !state.deltaItems.has(typeof item.id === 'string' ? item.id : '')
    ) {
      return {
        line: JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: item.text },
        }),
      };
    }
    return {};
  }
  if (method === 'thread/tokenUsage/updated') {
    const tu = params.tokenUsage as Record<string, unknown> | undefined;
    const last = tu?.last as TokenUsageLast | undefined;
    if (last) state.lastUsage = last;
    return {};
  }
  if (method === 'turn/completed') {
    const turn = params.turn as Record<string, unknown> | undefined;
    // Anything other than a clean completion (failed, interrupted, …) must
    // surface as an error so CodexAgent doesn't mark the session healthy
    // and accept partial text as a full turn.
    if (turn?.status !== 'completed') {
      const err = turn?.error as { message?: string } | null | undefined;
      return {
        done: true,
        error: err?.message ?? `codex turn ${String(turn?.status ?? 'unknown')}`,
      };
    }
    const u = state.lastUsage;
    return {
      done: true,
      line: JSON.stringify({
        type: 'turn.completed',
        usage: u
          ? {
              input_tokens: u.inputTokens ?? 0,
              cached_input_tokens: u.cachedInputTokens ?? 0,
              output_tokens: u.outputTokens ?? 0,
            }
          : undefined,
      }),
    };
  }
  return {};
}

type TokenUsageLast = {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
};

export function createAppServerTransport(
  opts: AppServerTransportOptions,
): CodexTransport {
  type QueueItem =
    | { kind: 'notification'; method: string; params: Record<string, unknown> }
    | { kind: 'end'; error: Error | null };

  let child: ChildProcessWithoutNullStreams | null = null;
  let threadId: string | null = null;
  let disposed = false;
  let generation = 0;
  let turnGeneration = 0;
  let turnLock: Promise<void> = Promise.resolve();

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }
  >();

  let queue: QueueItem[] = [];
  let waiter: (() => void) | null = null;
  const wake = () => {
    if (waiter) {
      const r = waiter;
      waiter = null;
      r();
    }
  };

  const send = (msg: Record<string, unknown>) => {
    try {
      child?.stdin.write(JSON.stringify(msg) + '\n');
    } catch {
      /* write-after-death surfaces via the close handler */
    }
  };

  const request = (
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const id = nextId++;
    const p = new Promise<Record<string, unknown>>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    send({ jsonrpc: '2.0', id, method, params });
    return p;
  };

  const teardown = (error: Error | null) => {
    child = null;
    threadId = null;
    generation++;
    for (const { reject } of pending.values()) {
      reject(error ?? new Error('codex app-server exited'));
    }
    pending.clear();
    queue.push({ kind: 'end', error });
    wake();
  };

  const spawnChild = () => {
    generation++;
    queue = [];
    // Reject requests addressed to a prior child that hasn't fired `close`
    // yet (the abort path kills it asynchronously) — its close/error
    // handlers are identity-guarded below, so nobody else will.
    for (const { reject } of pending.values()) {
      reject(new Error('codex app-server restarted'));
    }
    pending.clear();
    const c = spawn('codex', ['app-server'], {
      env: process.env,
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderrBuf = '';
    let buffer = '';
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (chunk: string) => {
      if (child !== c) return; // stale flush from a replaced child
      buffer += chunk;
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
        if (line.trim().length === 0) continue;
        let msg: JsonRpcMessage;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id !== undefined && msg.method === undefined) {
          // Response to one of our requests.
          const entry = pending.get(msg.id);
          if (entry) {
            pending.delete(msg.id);
            if (msg.error) {
              entry.reject(new Error(msg.error.message ?? 'app-server error'));
            } else {
              entry.resolve(msg.result ?? {});
            }
          }
        } else if (msg.method !== undefined && msg.id !== undefined) {
          // Server-initiated request (approval prompt etc). We never expect
          // these under approvalPolicy 'never'; answer with an error rather
          // than letting the server block forever on a reply.
          send({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32601, message: 'bramble: unsupported server request' },
          });
        } else if (msg.method !== undefined) {
          queue.push({
            kind: 'notification',
            method: msg.method,
            params: msg.params ?? {},
          });
          wake();
        }
      }
    });
    c.stderr.setEncoding('utf8');
    c.stderr.on('data', (chunk: string) => {
      stderrBuf += chunk;
    });
    c.on('close', code => {
      // A replaced child (abort → SIGTERM → respawn before `close` fires)
      // must not tear down the new one's state.
      if (child !== c) return;
      const err =
        code === 0 || code === null
          ? null
          : new Error(
              `codex app-server exited with code ${code}${
                stderrBuf
                  ? `: ${stderrBuf.trim().split('\n').slice(-10).join(' · ')}`
                  : ''
              }`,
            );
      teardown(err);
    });
    c.on('error', spawnErr => {
      if (child !== c) return;
      teardown(
        new Error(`failed to spawn \`codex\`: ${(spawnErr as Error).message}`),
      );
    });
    child = c;
  };

  const idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  // The handshake has no notification stream to watchdog — bound its two
  // requests directly so a wedged `codex app-server` can't freeze a turn.
  const handshakeTimeoutMs = idleTimeoutMs > 0 ? Math.min(idleTimeoutMs, 60_000) : 0;

  /** Spawn + handshake + thread/start if we don't have a live session. */
  const ensureSession = async () => {
    if (child && !child.killed && child.exitCode === null && threadId) return;
    // A prior half-alive child (e.g. its handshake failed) must not outlive
    // its replacement — kill it before spawning anew.
    if (child && !child.killed) child.kill('SIGTERM');
    spawnChild();
    try {
      await withTimeout(
        request('initialize', {
          clientInfo: { name: 'bramble', version: '0.1.0' },
        }),
        handshakeTimeoutMs,
        'codex app-server initialize',
      );
      send({ jsonrpc: '2.0', method: 'initialized' });
      const params: Record<string, unknown> = {
        cwd: opts.cwd ?? process.cwd(),
        approvalPolicy: 'never',
        // Don't persist debate threads into the user's codex session list.
        ephemeral: true,
      };
      if (opts.model) params.model = opts.model;
      if (opts.sandbox) params.sandbox = opts.sandbox;
      const res = await withTimeout(
        request('thread/start', params),
        handshakeTimeoutMs,
        'codex app-server thread/start',
      );
      const thread = res.thread as Record<string, unknown> | undefined;
      if (typeof thread?.id !== 'string') {
        throw new Error('codex app-server: thread/start returned no thread id');
      }
      threadId = thread.id;
    } catch (err) {
      // Failed handshake — don't leak the process; next turn respawns.
      const c = child;
      child = null;
      threadId = null;
      if (c && !c.killed) c.kill('SIGTERM');
      throw err;
    }
  };

  const runTurn = (
    promptText: string,
    signal: AbortSignal,
  ): AsyncIterable<string> =>
    (async function* () {
      let release!: () => void;
      const prior = turnLock;
      turnLock = new Promise<void>(r => {
        release = r;
      });

      await prior;
      try {
        if (disposed || signal.aborted) return;

        await ensureSession();
        // An abort that landed during the handshake never triggers onAbort
        // (once-listeners don't fire retroactively) — bail before sending
        // turn/start so the server doesn't run a turn nobody consumes. The
        // session stays alive for the next turn.
        if (signal.aborted) return;
        const active = child;
        if (!active || !threadId) return;
        turnGeneration = generation;

        const onAbort = () => {
          // Kill the process — next turn respawns with a fresh thread.
          if (active && !active.killed) active.kill('SIGTERM');
        };
        signal.addEventListener('abort', onAbort, { once: true });

        const turnParams: Record<string, unknown> = {
          threadId,
          input: [{ type: 'text', text: promptText }],
        };
        if (opts.reasoningEffort) turnParams.effort = opts.reasoningEffort;
        // Fire the request; failures surface as a rejected promise below or
        // as a failed turn/completed notification.
        let turnError: Error | null = null;
        request('turn/start', turnParams).catch(err => {
          turnError = err as Error;
          wake();
        });

        const state = {
          deltaItems: new Set<string>(),
          lastUsage: null as TokenUsageLast | null,
        };

        // If the server goes quiet mid-turn, kill it — teardown pushes an
        // end item and wakes the loop, which surfaces the watchdog's error.
        const watchdog = startIdleWatchdog({
          timeoutMs: idleTimeoutMs,
          what: '`codex app-server` turn',
          onTimeout: () => {
            if (active && !active.killed) killWithGrace(active);
            wake();
          },
        });

        try {
          while (true) {
            if (signal.aborted) return;
            if (turnError) throw turnError;
            const timedOut = watchdog.firedError();
            if (timedOut) throw timedOut;
            if (queue.length === 0) {
              await new Promise<void>(resolve => {
                waiter = resolve;
              });
              continue;
            }
            const next = queue.shift()!;
            watchdog.pet();
            if (next.kind === 'end') {
              if (next.error && !signal.aborted) throw next.error;
              return;
            }
            const t = translateNotification(next.method, next.params, state);
            if (t.line) yield t.line;
            if (t.error) throw new Error(t.error);
            if (t.done) return;
          }
        } finally {
          watchdog.stop();
          signal.removeEventListener('abort', onAbort);
          if (signal.aborted) {
            // Abort killed the child mid-turn; make session loss visible
            // immediately (close handler will also fire, which is fine).
            threadId = null;
          }
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
      threadId = null;
      // The killed child's close handler is identity-guarded out once
      // `child` is null, so unblock any in-flight turn here: reject pending
      // requests and push a terminal queue item to wake the consumer.
      for (const { reject } of pending.values()) {
        reject(new Error('codex app-server transport disposed'));
      }
      pending.clear();
      queue.push({ kind: 'end', error: null });
      wake();
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
