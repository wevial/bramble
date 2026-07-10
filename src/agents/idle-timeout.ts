import type { ChildProcess } from 'node:child_process';

/**
 * Default idle timeout for an in-flight agent turn: if the subprocess
 * produces no output for this long, it's treated as hung and killed.
 * Generous because reasoning models can go quiet while thinking or running
 * a long tool call. Overridable via --turn-timeout; <= 0 disables.
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

export type IdleWatchdog = {
  /** Reset the countdown — call whenever the child shows signs of life. */
  pet(): void;
  /** Cancel the watchdog (turn finished or errored some other way). */
  stop(): void;
  /** Non-null once the watchdog has fired; the error to surface. */
  firedError(): Error | null;
};

const NOOP_WATCHDOG: IdleWatchdog = {
  pet() {},
  stop() {},
  firedError: () => null,
};

/**
 * Watch an in-flight turn for output gaps. When `timeoutMs` elapses without
 * a `pet()`, `onTimeout` runs once (kill the child, wake the consumer loop)
 * and `firedError()` becomes non-null. Consumer loops should check
 * `firedError()` each iteration and throw it.
 */
export function startIdleWatchdog(opts: {
  timeoutMs: number;
  /** Subject for the error message, e.g. "`claude` turn". */
  what: string;
  onTimeout: () => void;
}): IdleWatchdog {
  if (opts.timeoutMs <= 0) return NOOP_WATCHDOG;

  let fired: Error | null = null;
  let timer: NodeJS.Timeout | null = null;

  const arm = () => {
    timer = setTimeout(() => {
      timer = null;
      fired = new Error(
        `${opts.what} produced no output for ${Math.round(opts.timeoutMs / 1000)}s — killed (override with --turn-timeout)`,
      );
      opts.onTimeout();
    }, opts.timeoutMs);
    timer.unref?.();
  };
  arm();

  return {
    pet() {
      if (fired) return;
      if (timer) clearTimeout(timer);
      arm();
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    firedError: () => fired,
  };
}

/**
 * SIGTERM now; SIGKILL after `graceMs` if the child hasn't exited. The
 * escalation timer is unref'd and cancelled on exit so it never holds the
 * event loop open.
 */
export function killWithGrace(child: ChildProcess, graceMs = 5_000): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const hammer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }, graceMs);
  hammer.unref?.();
  child.once('exit', () => clearTimeout(hammer));
}

/**
 * Reject `promise` if it doesn't settle within `timeoutMs`. Used for the
 * app-server handshake, which has no output stream to watchdog.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  what: string,
): Promise<T> {
  if (timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`${what} timed out after ${Math.round(timeoutMs / 1000)}s`),
      );
    }, timeoutMs);
    timer.unref?.();
    promise.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
