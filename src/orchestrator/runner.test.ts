import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeAgent } from '../agents/fake.js';
import { startDebate } from './runner.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bramble-runner-'));
});

function paths() {
  return { transcriptPath: join(tmp, 'transcript.jsonl') };
}

function tick(ms = 20) {
  return new Promise(r => setTimeout(r, ms));
}

describe('startDebate — interview → debate → done', () => {
  it('alternates interview turns, blocks for user answers, then transitions on mutual ready', async () => {
    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    claude.setResponses([
      { kind: 'interview', commentary: 'q1', question: 'who are users?' },
      { kind: 'interview', commentary: 'enough', ready: true },
      {
        kind: 'debate',
        commentary: 'seed',
        edits: [{ find: '', replace: '# Spec\n\n## Goals\nDraft.' }],
        verdict: 'lgtm',
      },
    ]);
    codex.setResponses([
      { kind: 'interview', commentary: 'q1', question: 'compliance?' },
      { kind: 'interview', commentary: 'enough', ready: true },
      { kind: 'debate', commentary: 'agree', edits: [], verdict: 'lgtm' },
    ]);

    const handle = startDebate({
      agents: { claude, codex },
      prompt: 'design x',
      ...paths(),
    });

    // Wait for claude's first interview turn → blocks for user answer.
    await tick(50);
    handle.interject('internal employees');
    await tick(50);
    handle.interject('SOC 2');
    await tick(50);
    // Two interview turns each so far. Both signal ready next.
    handle.interject('-');
    await tick(50);
    // codex.interview turn 2 will signal ready and flip phase. No user
    // answer is needed afterward — debate begins.
    const finalState = await handle.done;
    expect(finalState.phase).toBe('done');
    expect(finalState.endReason).toBe('mutual_lgtm');
    expect(finalState.spec).toContain('## Goals');
    expect(finalState.interview).toHaveLength(4);
  });

  it('still blocks for a user answer when the agent emits a malformed turn (no ready, no question)', async () => {
    // Regression: gating the interview fast-path on `question === null`
    // alone would let an empty/parse-failed response advance straight to
    // the next agent. Gate on `ready` instead.
    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    // Plain string — no JSON at all → parseInterviewMessage falls back to
    // {commentary: raw, question: null, ready: false}.
    claude.setResponse('not a json response at all');
    codex.setResponse({ kind: 'interview', commentary: '', question: 'q', ready: false });

    const handle = startDebate({
      agents: { claude, codex },
      prompt: 'x',
      ...paths(),
    });
    // Give claude's turn time to land. With the bug, the runner would
    // immediately call codex too. Without the bug, it waits.
    await tick(80);
    handle.abort();
    const finalState = await handle.done;
    // Claude spoke once; codex did NOT speak (runner was waiting).
    expect(finalState.interview.filter(t => t.speaker === 'claude')).toHaveLength(1);
    expect(finalState.interview.filter(t => t.speaker === 'codex')).toHaveLength(0);
  });

  it('user_done force-skips the rest of the interview', async () => {
    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    // Both agents ask forever — only /done can break out.
    claude.setResponses([
      { kind: 'interview', commentary: '', question: 'q', ready: false },
      {
        kind: 'debate',
        commentary: 'seed',
        edits: [{ find: '', replace: '# Spec' }],
        verdict: 'lgtm',
      },
    ]);
    codex.setResponses([
      { kind: 'interview', commentary: '', question: 'q', ready: false },
      { kind: 'debate', commentary: 'agree', edits: [], verdict: 'lgtm' },
    ]);

    const handle = startDebate({
      agents: { claude, codex },
      prompt: 'design x',
      ...paths(),
    });

    await tick(50);
    handle.done_interview();
    const finalState = await handle.done;
    expect(finalState.phase).toBe('done');
  });

  it('writes a session entry first to the transcript', async () => {
    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    claude.setResponse({ kind: 'interview', commentary: '', ready: true });
    codex.setResponse({ kind: 'interview', commentary: '', ready: true });
    // Override: in this oddball case both are ready immediately. claude's
    // turn signals ready; codex's turn also signals ready → flip to debate.
    // Without debate edits the round closes empty, decay fires after 2 empty
    // rounds — but with maxRounds=8 default and zero charsChanged, decay
    // fires at round 2.

    const handle = startDebate({
      agents: { claude, codex },
      prompt: 'tiny goal',
      ...paths(),
    });
    await handle.done;
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(paths().transcriptPath, 'utf8');
    const first = JSON.parse(raw.split('\n')[0]!);
    expect(first.type).toBe('session');
    expect(first.prompt).toBe('tiny goal');
    expect(first.config.maxRounds).toBe(8);
  });

  it('updateConfig is reflected in state immediately', async () => {
    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    claude.setResponses([
      { kind: 'interview', commentary: '', ready: true },
      {
        kind: 'debate',
        commentary: 'seed',
        edits: [{ find: '', replace: '# Spec' }],
        verdict: 'lgtm',
      },
    ]);
    codex.setResponses([
      { kind: 'interview', commentary: '', ready: true },
      { kind: 'debate', commentary: 'agree', edits: [], verdict: 'lgtm' },
    ]);

    let observedMax: number | null = null;
    const handle = startDebate({
      agents: { claude, codex },
      prompt: 'x',
      onState: s => {
        observedMax = s.config.maxRounds;
      },
      ...paths(),
    });
    await tick(20);
    handle.updateConfig({ maxRounds: 16, decayThreshold: 99 });
    await tick(20);
    expect(observedMax).toBe(16);
    await handle.done;
  });

});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});
