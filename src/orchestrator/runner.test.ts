import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeAgent } from '../agents/fake.js';
import { startDebate } from './runner.js';
import type { State } from './state.js';

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
    // Both agents lgtm in debate → awaiting user signoff. /done finalizes.
    await tick(50);
    handle.done_interview();
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
    // After interview /done both agents lgtm → signoff pause; /done again finalizes.
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
    // Mutual LGTM lands → signoff pause; /done finalizes.
    await tick(20);
    handle.done_interview();
    await handle.done;
  });

  it('resumes into the signoff pause without scheduling another agent turn', async () => {
    // Regression: rehydrating a transcript that landed mid-signoff used to
    // skip the wait at the top of the loop and immediately ask one of the
    // agents for another turn.
    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    // If the bug were present, whichever agent is asked first would speak
    // a debate turn — assert neither does.
    claude.setResponse({
      kind: 'debate',
      commentary: 'should never run',
      edits: [],
      verdict: 'continue',
    });
    codex.setResponse({
      kind: 'debate',
      commentary: 'should never run',
      edits: [],
      verdict: 'continue',
    });

    const T = new Date().toISOString();
    const initialState: State = {
      phase: 'debate',
      speaker: 'idle',
      prompt: 'design x',
      interview: [],
      userAnswers: [],
      readyAgents: ['claude', 'codex'],
      debate: [
        {
          speaker: 'claude',
          commentary: '',
          edits: [{ find: '', replace: '# Spec' }],
          applied: [{ find: '', replace: '# Spec' }],
          rejected: [],
          verdict: 'lgtm',
          charsChanged: 6,
          round: 1,
          timestamp: T,
        },
        {
          speaker: 'codex',
          commentary: '',
          edits: [],
          applied: [],
          rejected: [],
          verdict: 'lgtm',
          charsChanged: 0,
          round: 1,
          timestamp: T,
        },
      ],
      spec: '# Spec',
      round: 1,
      roundVolumes: [6],
      lgtmThisRound: [],
      config: { maxRounds: 8, decayThreshold: 50, decayWindow: 2 },
      awaitingSignoff: true,
    };

    const handle = startDebate({
      agents: { claude, codex },
      prompt: 'design x',
      initialState,
      ...paths(),
    });

    await tick(80);
    // Still paused — no new agent turn landed.
    handle.done_interview();
    const finalState = await handle.done;
    expect(finalState.debate).toHaveLength(2);
    expect(finalState.phase).toBe('done');
    expect(finalState.endReason).toBe('mutual_lgtm');
  });

  it('userEdit during signoff replaces the spec, re-opens debate, and logs user_edit', async () => {
    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    // After the user edits the spec mid-signoff, the next agent turn lands.
    // We give claude one more debate turn to consume; codex never speaks
    // again before we abort.
    claude.setResponse({
      kind: 'debate',
      commentary: 'reacting to user edit',
      edits: [],
      verdict: 'continue',
    });
    codex.setResponse({
      kind: 'debate',
      commentary: 'unused',
      edits: [],
      verdict: 'continue',
    });

    const T = new Date().toISOString();
    const initialState: State = {
      phase: 'debate',
      speaker: 'idle',
      prompt: 'design x',
      interview: [],
      userAnswers: [],
      readyAgents: ['claude', 'codex'],
      debate: [
        {
          speaker: 'claude',
          commentary: '',
          edits: [{ find: '', replace: '# Spec' }],
          applied: [{ find: '', replace: '# Spec' }],
          rejected: [],
          verdict: 'lgtm',
          charsChanged: 6,
          round: 1,
          timestamp: T,
        },
        {
          speaker: 'codex',
          commentary: '',
          edits: [],
          applied: [],
          rejected: [],
          verdict: 'lgtm',
          charsChanged: 0,
          round: 1,
          timestamp: T,
        },
      ],
      spec: '# Spec',
      round: 1,
      roundVolumes: [6],
      lgtmThisRound: [],
      config: { maxRounds: 8, decayThreshold: 50, decayWindow: 2 },
      awaitingSignoff: true,
    };

    const handle = startDebate({
      agents: { claude, codex },
      prompt: 'design x',
      initialState,
      ...paths(),
    });

    await tick(40);
    handle.userEdit('# Spec\n\n## Risks\nadded by user');
    await tick(80);
    handle.abort();
    const finalState = await handle.done;
    expect(finalState.spec).toBe('# Spec\n\n## Risks\nadded by user');
    expect(finalState.awaitingSignoff).toBeFalsy();
    expect(finalState.lgtmThisRound).toEqual([]);

    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(paths().transcriptPath, 'utf8');
    const types = raw
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l).type);
    expect(types).toContain('user_edit');
  });

  it('interject during a streaming interview turn does NOT abort the agent; the answer queues until the wait point', async () => {
    // Regression: previously, typing while the interview agent was mid-stream
    // fell through to the debate branch and aborted the turn, losing the
    // agent's question. Fix: queue the user input in interview phase and
    // deliver it at the next wait point.
    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    claude.setTokenDelayMs(5); // make the stream long enough to interject mid-flight
    claude.setResponses([
      { kind: 'interview', commentary: 'asking about users…', question: 'who?', ready: false },
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

    const handle = startDebate({
      agents: { claude, codex },
      prompt: 'design x',
      ...paths(),
    });

    // Interject while claude is still streaming its first question.
    await tick(15);
    handle.interject('users are internal employees');
    await tick(200);
    handle.done_interview();
    const finalState = await handle.done;

    // Claude's full first turn landed (NOT aborted) — commentary intact.
    const claudeTurn = finalState.interview.find(t => t.speaker === 'claude');
    expect(claudeTurn?.commentary).toBe('asking about users…');
    expect(claudeTurn?.question).toBe('who?');
    // User's answer was recorded.
    expect(finalState.userAnswers.map(a => a.content)).toContain(
      'users are internal employees',
    );
  });

  it('addContext records a userAnswer without resolving the interview wait', async () => {
    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    claude.setResponses([
      { kind: 'interview', commentary: 'asking', question: 'who?', ready: false },
      { kind: 'interview', commentary: '', ready: true },
      {
        kind: 'debate',
        commentary: 'seed',
        edits: [{ find: '', replace: '# Spec' }],
        verdict: 'lgtm',
      },
    ]);
    codex.setResponses([
      { kind: 'interview', commentary: 'should not run before answer', question: 'q2', ready: false },
      { kind: 'debate', commentary: 'agree', edits: [], verdict: 'lgtm' },
    ]);

    const handle = startDebate({
      agents: { claude, codex },
      prompt: 'design x',
      ...paths(),
    });

    // Wait for claude's question to land and the runner to enter the wait.
    await tick(60);
    handle.addContext('also: must run on linux');
    // Give time for any (incorrect) follow-on turn to slip through.
    await tick(60);
    // Codex must NOT have spoken — the wait is still in effect.
    expect(handle).toBeDefined();
    handle.abort();
    const finalState = await handle.done;
    expect(finalState.userAnswers.map(a => a.content)).toContain(
      'also: must run on linux',
    );
    // claude turn 1 only; codex never got scheduled.
    expect(finalState.interview.filter(t => t.speaker === 'codex')).toHaveLength(0);
  });

});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});
