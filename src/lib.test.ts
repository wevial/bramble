import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  McpSessionManager,
  sessionWaiting,
  type McpSession,
  type Waiting,
} from './lib.js';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Poll sessionWaiting until `pred` holds or the budget runs out. */
async function waitFor(
  session: McpSession,
  pred: (w: Waiting) => boolean,
  budgetMs = 5000,
): Promise<Waiting> {
  const deadline = Date.now() + budgetMs;
  let last: Waiting = sessionWaiting(session);
  while (Date.now() < deadline) {
    last = sessionWaiting(session);
    if (pred(last)) return last;
    await delay(20);
  }
  throw new Error(`waitFor timed out; last waiting: ${JSON.stringify(last)}`);
}

describe('library entry (src/lib.ts)', () => {
  let root: string;
  let mgr: McpSessionManager;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bramble-lib-'));
    mgr = new McpSessionManager({ root, cwd: root, mock: true, format: 'md' });
  });

  afterEach(async () => {
    for (const s of mgr.liveSessions()) mgr.abortSession(s);
    await delay(50);
    rmSync(root, { recursive: true, force: true });
  });

  it('drives a full mock debate in-process: start → answer → lock → accept', async () => {
    const session = mgr.start({ goal: 'design an auth system' });
    expect(session.status).toBe('running');

    const interview = await waitFor(session, w => w.kind === 'interview');
    if (interview.kind !== 'interview') throw new Error('unreachable');
    expect(interview.question).toContain('primary users');
    mgr.answer(session, 'Internal employees only, via SSO.');

    await waitFor(session, w => w.kind === 'criteria');
    mgr.finish(session); // lock criteria, open the debate

    await waitFor(session, w => w.kind === 'signoff');
    mgr.finish(session); // accept the spec
    await session.finalize;

    expect(session.status).toBe('done');
    expect(existsSync(session.paths.specPath)).toBe(true);
    expect(readFileSync(session.paths.specPath, 'utf8')).toContain(
      'Authentication',
    );
    expect(existsSync(session.paths.checkpointPath)).toBe(true);
  });
});
