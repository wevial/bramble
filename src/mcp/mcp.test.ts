import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpSessionManager, sessionWaiting, type McpSession } from './sessions.js';
import { buildMcpServer } from './server.js';
import { initialState, type InterviewTurn, type CriteriaTurn } from '../orchestrator/state.js';

type ToolResult = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};

function textOf(r: ToolResult): string {
  const t = r.content.find(c => c.type === 'text');
  return t?.text ?? '';
}

function jsonOf(r: ToolResult): any {
  return JSON.parse(textOf(r));
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Poll bramble_status until `pred` holds or the budget runs out. */
async function pollStatus(
  client: Client,
  session: string,
  pred: (s: any) => boolean,
  budgetMs = 5000,
): Promise<any> {
  const deadline = Date.now() + budgetMs;
  let last: any;
  while (Date.now() < deadline) {
    const r = await call(client, 'bramble_status', { session });
    last = jsonOf(r);
    if (pred(last)) return last;
    await delay(20);
  }
  throw new Error(
    `pollStatus timed out; last status: ${JSON.stringify(last)}`,
  );
}

describe('bramble MCP server', () => {
  let root: string;
  let client: Client;
  let mgr: McpSessionManager;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bramble-mcp-'));
    mgr = new McpSessionManager({ root, cwd: root, mock: true, format: 'md' });
    const server = buildMcpServer(mgr);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  afterEach(async () => {
    // Abort any still-running background sessions so they stop advancing, then
    // let in-flight transcript writes flush before removing the temp dir — so
    // teardown doesn't race a write against the rmSync below. (Not awaiting
    // handle.done: a session aborted mid-turn parks its loop at a wait whose
    // abort listener was registered after the signal fired, so done may never
    // resolve — but the parked loop writes nothing further, which is all we
    // need here.)
    for (const s of mgr.liveSessions()) mgr.abortSession(s);
    await delay(50);
    await client.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('lists the six tools', async () => {
    const tools = await client.listTools();
    const names = tools.tools.map(t => t.name).sort();
    expect(names).toEqual([
      'bramble_answer',
      'bramble_done',
      'bramble_get_spec',
      'bramble_list',
      'bramble_start',
      'bramble_status',
    ]);
  });

  it('drives a full happy path: start → answer → criteria → signoff → done', async () => {
    const started = jsonOf(
      await call(client, 'bramble_start', { goal: 'design an auth system' }),
    );
    expect(started.session).toBeTruthy();
    expect(started.status).toBe('running');
    const session = started.session as string;

    // Interview wait — status carries the question and the relay instruction.
    const interview = await pollStatus(
      client,
      session,
      s => s.waiting.kind === 'interview',
    );
    expect(interview.waiting.speaker).toBe('claude');
    expect(interview.waiting.question).toContain('primary users');
    expect(interview.instruction).toContain('RELAY TO YOUR HUMAN');
    expect(interview.instruction).toContain('primary users');
    expect(interview.status).toBe('awaiting_input');

    // Answer as the human — session advances toward criteria.
    const answered = jsonOf(
      await call(client, 'bramble_answer', {
        session,
        text: 'Internal employees only, via SSO.',
      }),
    );
    expect(answered.session).toBe(session);

    // Criteria wait — a proposed list plus its own relay instruction.
    const criteria = await pollStatus(
      client,
      session,
      s => s.waiting.kind === 'criteria',
    );
    expect(criteria.waiting.proposed.length).toBeGreaterThan(0);
    expect(criteria.instruction).toContain('PROPOSED CRITERIA');

    // Lock the criteria and open the debate.
    await call(client, 'bramble_done', { session });

    // Debate converges to mutual LGTM → signoff wait.
    const signoff = await pollStatus(
      client,
      session,
      s => s.waiting.kind === 'signoff',
    );
    expect(signoff.instruction).toContain("sign-off");

    // Draft is available and not yet accepted.
    const draft = jsonOf(
      await call(client, 'bramble_get_spec', { session }),
    );
    expect(draft.accepted).toBe(false);
    expect(draft.spec).toContain('Authentication Spec');

    // Finalize on the human's acceptance.
    await call(client, 'bramble_done', { session });
    const done = await pollStatus(
      client,
      session,
      s => s.status === 'done' || s.waiting.kind === 'done',
    );
    expect(done.endReason).toBe('mutual_lgtm');

    // Final spec is accepted.
    const finalSpec = jsonOf(
      await call(client, 'bramble_get_spec', { session }),
    );
    expect(finalSpec.accepted).toBe(true);
    expect(finalSpec.spec).toContain('Success Criteria');
  });

  it('rejects interview "auto"', async () => {
    const r = await call(client, 'bramble_start', {
      goal: 'x',
      interview: 'auto',
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('auto');
  });

  it('rejects an unknown interview intensity', async () => {
    const r = await call(client, 'bramble_start', {
      goal: 'x',
      interview: 'ferocious',
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('ferocious');
  });

  it('errors on unknown session', async () => {
    const r = await call(client, 'bramble_status', { session: 'nope' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('no session named');
  });

  it('rejects a duplicate session name', async () => {
    await call(client, 'bramble_start', { goal: 'a', name: 'dup' });
    const r = await call(client, 'bramble_start', { goal: 'b', name: 'dup' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('already exists');
  });

  it('rejects an answer when nothing is pending (session finished)', async () => {
    const started = jsonOf(
      await call(client, 'bramble_start', { goal: 'coin flip cli' }),
    );
    const session = started.session as string;
    // Drive to done: answer interview, lock criteria, sign off.
    await pollStatus(client, session, s => s.waiting.kind === 'interview');
    await call(client, 'bramble_answer', { session, text: 'anyone' });
    await pollStatus(client, session, s => s.waiting.kind === 'criteria');
    await call(client, 'bramble_done', { session });
    await pollStatus(client, session, s => s.waiting.kind === 'signoff');
    await call(client, 'bramble_done', { session });
    await pollStatus(
      client,
      session,
      s => s.status === 'done' || s.waiting.kind === 'done',
    );

    const r = await call(client, 'bramble_answer', {
      session,
      text: 'too late',
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('finished');
  });

  it('lists a running session', async () => {
    const started = jsonOf(
      await call(client, 'bramble_start', {
        goal: 'a todo app',
        name: 'listme',
      }),
    );
    // Wait until it reaches a wait point so the transcript exists on disk.
    await pollStatus(client, started.session, s =>
      ['interview', 'criteria', 'signoff'].includes(s.waiting.kind),
    );
    const list = jsonOf(await call(client, 'bramble_list', {}));
    const row = list.sessions.find((s: any) => s.name === 'listme');
    expect(row).toBeTruthy();
    expect(row.live).toBe(true);
    expect(row.goal).toBe('a todo app');
  });

  // Finding 6: MCP-created sessions must write prompt.txt, so a detached
  // bramble_list can recover the goal after a restart.
  it('writes prompt.txt at start', async () => {
    const started = jsonOf(
      await call(client, 'bramble_start', {
        goal: 'a goal worth recording',
        name: 'sidecar',
      }),
    );
    expect(started.session).toBe('sidecar');
    const promptFile = join(root, 'sidecar', 'prompt.txt');
    expect(existsSync(promptFile)).toBe(true);
    expect(readFileSync(promptFile, 'utf8')).toBe('a goal worth recording');
  });

  // Finding 3: a name already present on disk (from a prior server run) must be
  // rejected — appending a second run to its transcript would break replay.
  it('rejects a name that already exists on disk', async () => {
    mkdirSync(join(root, 'ondisk'), { recursive: true });
    writeFileSync(
      join(root, 'ondisk', 'transcript.jsonl'),
      '{"type":"session","prompt":"prior run"}\n',
      'utf8',
    );
    const r = await call(client, 'bramble_start', {
      goal: 'new run',
      name: 'ondisk',
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('already exists');
  });

  // Finding 2: two concurrent bramble_answer calls on the same wait must not
  // both be applied (the second would silently become the NEXT turn's answer).
  it('rejects a second concurrent answer for the same wait', async () => {
    const started = jsonOf(
      await call(client, 'bramble_start', { goal: 'concurrency' }),
    );
    const session = started.session as string;
    await pollStatus(client, session, s => s.waiting.kind === 'interview');
    // Fire both without awaiting the first, so the second lands inside the
    // first's release window.
    const [a, b] = await Promise.all([
      call(client, 'bramble_answer', { session, text: 'first' }),
      call(client, 'bramble_answer', { session, text: 'second' }),
    ]);
    expect([a.isError, b.isError].filter(Boolean).length).toBe(1);
    const errored = a.isError ? a : b;
    // Either the concurrency guard or the "not waiting" guard rejects it.
    expect(textOf(errored)).toMatch(/being applied|not waiting/);
  });

  // Finding 4: bramble_done's finalize path must persist spec + checkpoint to
  // disk before it reports success (not just wait a fixed 40ms).
  it('persists spec and checkpoint to disk before reporting done', async () => {
    const started = jsonOf(
      await call(client, 'bramble_start', { goal: 'persisted deliverables' }),
    );
    const session = started.session as string;
    await pollStatus(client, session, s => s.waiting.kind === 'interview');
    await call(client, 'bramble_answer', { session, text: 'anyone' });
    await pollStatus(client, session, s => s.waiting.kind === 'criteria');
    await call(client, 'bramble_done', { session });
    await pollStatus(client, session, s => s.waiting.kind === 'signoff');
    // The done that finalizes must not resolve until the artifacts exist.
    await call(client, 'bramble_done', { session });
    expect(existsSync(join(root, session, 'spec.md'))).toBe(true);
    expect(existsSync(join(root, session, 'checkpoint.md'))).toBe(true);
  });

  // Finding 5: a detached get_spec with no format must default to the STORED
  // format, so body/format/path all agree (an XML session mustn't report md).
  it('detached get_spec defaults to the stored format, not md', async () => {
    const started = jsonOf(
      await call(client, 'bramble_start', {
        goal: 'xml deliverable',
        name: 'xmlsess',
        format: 'xml',
      }),
    );
    const session = started.session as string;
    await pollStatus(client, session, s => s.waiting.kind === 'interview');
    await call(client, 'bramble_answer', { session, text: 'anyone' });
    await pollStatus(client, session, s => s.waiting.kind === 'criteria');
    await call(client, 'bramble_done', { session });
    await pollStatus(client, session, s => s.waiting.kind === 'signoff');
    await call(client, 'bramble_done', { session });
    await pollStatus(
      client,
      session,
      s => s.status === 'done' || s.waiting.kind === 'done',
    );
    // Fresh manager over the same root: the session is now detached.
    const mgr2 = new McpSessionManager({
      root,
      cwd: root,
      mock: true,
      format: 'md',
    });
    const det = await mgr2.loadDetached('xmlsess');
    expect(det?.format).toBe('xml');
    expect(det?.paths.specPath).toMatch(/spec\.xml$/);

    const server2 = buildMcpServer(mgr2);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client2 = new Client({ name: 't2', version: '0.0.0' });
    await Promise.all([client2.connect(ct), server2.connect(st)]);
    const spec = jsonOf(await call(client2, 'bramble_get_spec', { session: 'xmlsess' }));
    expect(spec.format).toBe('xml');
    expect(spec.path).toMatch(/spec\.xml$/);
    await client2.close();
  });
});

// Finding 7 (and 1): once an interview/criteria answer is delivered, the state
// still LOOKS like the same wait during the runner's next moderator.pick.
// sessionWaiting must down-rank the already-answered wait to 'thinking' using
// the per-session watermark, so the caller isn't told to re-relay a question
// the human already answered (and bramble_done can't fire mid-turn).
describe('sessionWaiting watermark', () => {
  function interviewSession(releasedLen: number): McpSession {
    const turn: InterviewTurn = {
      speaker: 'claude',
      commentary: 'scoping',
      question: 'Who are the users?',
      ready: false,
      timestamp: new Date().toISOString(),
    };
    const state = {
      ...initialState('goal'),
      phase: 'interview' as const,
      speaker: 'idle' as const,
      interview: [turn],
    };
    return {
      state,
      releasedInterviewLen: releasedLen,
      releasedCriteriaLen: 0,
    } as unknown as McpSession;
  }

  function criteriaSession(releasedLen: number): McpSession {
    const turn: CriteriaTurn = {
      speaker: 'claude',
      commentary: 'proposing',
      proposed: ['Users can log in'],
      timestamp: new Date().toISOString(),
    };
    const state = {
      ...initialState('goal'),
      phase: 'criteria' as const,
      speaker: 'idle' as const,
      criteriaTurns: [turn],
    };
    return {
      state,
      releasedInterviewLen: 0,
      releasedCriteriaLen: releasedLen,
    } as unknown as McpSession;
  }

  it('reports the interview wait before it is answered', () => {
    expect(sessionWaiting(interviewSession(0)).kind).toBe('interview');
  });

  it('down-ranks an already-answered interview wait to thinking', () => {
    // Watermark == interview.length: the last question was the one we released.
    expect(sessionWaiting(interviewSession(1)).kind).toBe('thinking');
  });

  it('reports the criteria wait before it is answered', () => {
    expect(sessionWaiting(criteriaSession(0)).kind).toBe('criteria');
  });

  it('down-ranks an already-answered criteria wait to thinking', () => {
    expect(sessionWaiting(criteriaSession(1)).kind).toBe('thinking');
  });
});
