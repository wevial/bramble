import { describe, it, expect } from 'bun:test';
import { startIdleWatchdog, withTimeout } from './idle-timeout.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('startIdleWatchdog', () => {
  it('fires onTimeout and exposes the error after the idle window', async () => {
    let fired = 0;
    const wd = startIdleWatchdog({
      timeoutMs: 30,
      what: '`claude` turn',
      onTimeout: () => fired++,
    });
    expect(wd.firedError()).toBeNull();
    await sleep(60);
    expect(fired).toBe(1);
    expect(wd.firedError()?.message).toContain('no output for');
    wd.stop();
  });

  it('pet() resets the countdown', async () => {
    let fired = 0;
    const wd = startIdleWatchdog({
      timeoutMs: 50,
      what: 'x',
      onTimeout: () => fired++,
    });
    for (let i = 0; i < 4; i++) {
      await sleep(20);
      wd.pet();
    }
    expect(fired).toBe(0);
    expect(wd.firedError()).toBeNull();
    wd.stop();
  });

  it('stop() prevents a pending fire', async () => {
    let fired = 0;
    const wd = startIdleWatchdog({
      timeoutMs: 30,
      what: 'x',
      onTimeout: () => fired++,
    });
    wd.stop();
    await sleep(60);
    expect(fired).toBe(0);
  });

  it('timeoutMs <= 0 disables the watchdog', async () => {
    let fired = 0;
    const wd = startIdleWatchdog({
      timeoutMs: 0,
      what: 'x',
      onTimeout: () => fired++,
    });
    await sleep(40);
    expect(fired).toBe(0);
    expect(wd.firedError()).toBeNull();
    wd.stop();
  });
});

describe('withTimeout', () => {
  it('passes through a settling promise', async () => {
    await expect(withTimeout(Promise.resolve(42), 100, 'x')).resolves.toBe(42);
  });

  it('rejects a hanging promise with a labeled error', async () => {
    const hang = new Promise(() => {});
    await expect(withTimeout(hang, 30, 'codex handshake')).rejects.toThrow(
      /codex handshake timed out/,
    );
  });

  it('timeoutMs <= 0 disables the bound', async () => {
    const slow = sleep(50).then(() => 'ok');
    await expect(withTimeout(slow, 0, 'x')).resolves.toBe('ok');
  });
});
