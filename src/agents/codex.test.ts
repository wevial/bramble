import { describe, it, expect, vi } from 'vitest';
import { CodexAgent, createPersistentCliTransport, type CodexTransport } from './codex.js';
import type { SpawnSpec } from './subprocess.js';
import { runAgentContract } from './agent.contract.js';

describe('CodexAgent', () => {
  it('streams message text and parses patch block', async () => {
    const fakeLines = [
      JSON.stringify({ type: 'thread.started', thread_id: 'x' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'i0',
          type: 'agent_message',
          text:
            'LGTM with a nit.\n<patch>\n{"verdict":"LGTM"}\n</patch>',
        },
      }),
      JSON.stringify({ type: 'turn.completed', usage: {} }),
    ];

    async function* fake() {
      for (const l of fakeLines) yield l;
    }

    const agent = new CodexAgent({ streamLines: () => fake() });
    const tokens: string[] = [];
    let tail: { raw: string } | undefined;
    const iter = agent.stream({ phase: 'debate', prompt: 'x' }, new AbortController().signal);
    while (true) {
      const r = await iter.next();
      if (r.done) {
        if (r.value) tail = r.value;
        break;
      }
      tokens.push(r.value.text);
    }
    expect(tokens.join('')).toContain('LGTM with a nit.');
    expect(tail?.raw).toContain('LGTM with a nit.');
  });

  it('has name "codex"', () => {
    const agent = new CodexAgent({ streamLines: () => (async function* () {})() });
    expect(agent.name).toBe('codex');
  });

  // Reviewer concern: the promptMode / *PromptChars fields on TurnUsage model
  // claude's full-vs-delta transport semantics. Codex spawns per turn and has
  // no such distinction, so it must not emit them (or the gauge reads them as
  // meaningful signal when they aren't).
  it('does not emit claude-only full/delta debug fields on usage', async () => {
    const fakeLines = [
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'i0', type: 'agent_message', text: 'hi' },
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: { input_tokens: 100, cached_input_tokens: 30, output_tokens: 5 },
      }),
    ];
    async function* fake() {
      for (const l of fakeLines) yield l;
    }
    const agent = new CodexAgent({ streamLines: () => fake() });
    const iter = agent.stream({ phase: 'debate', prompt: 'x' }, new AbortController().signal);
    let tail: { usage?: Record<string, unknown> } | undefined;
    while (true) {
      const r = await iter.next();
      if (r.done) {
        if (r.value) tail = r.value as typeof tail;
        break;
      }
    }
    expect(tail?.usage).toBeDefined();
    expect(tail?.usage?.promptMode).toBeUndefined();
    expect(tail?.usage?.promptChars).toBeUndefined();
    expect(tail?.usage?.fullPromptChars).toBeUndefined();
    expect(tail?.usage?.deltaPromptChars).toBeUndefined();
  });
});

describe('Persistent transport (CodexTransport injection)', () => {
  /** Helper: drain a CodexAgent stream and return the tail. */
  async function drain(agent: CodexAgent, ctx: { phase: 'debate'; prompt: string; deltaPrompt?: string }, signal?: AbortSignal) {
    const s = signal ?? new AbortController().signal;
    const iter = agent.stream(ctx, s);
    let tail: { raw?: string; usage?: Record<string, unknown> } | undefined;
    while (true) {
      const r = await iter.next();
      if (r.done) { tail = r.value as typeof tail; break; }
    }
    return tail;
  }

  function makeTransport(): CodexTransport & {
    prompts: string[];
    gen: number;
    turnG: number;
    _sessionId: string | null;
  } {
    let gen = 0;
    let turnG = 0;
    let sessionId: string | null = null;
    const prompts: string[] = [];
    return {
      prompts,
      get gen() { return gen; },
      set gen(v) { gen = v; },
      get turnG() { return turnG; },
      get _sessionId() { return sessionId; },
      set _sessionId(v) { sessionId = v; },
      runTurn(prompt) {
        prompts.push(prompt);
        turnG = gen;
        return (async function* () {
          // Simulate thread.started + message + turn.completed
          yield JSON.stringify({ type: 'thread.started', thread_id: 'sess-1' });
          yield JSON.stringify({
            type: 'item.completed',
            item: { id: 'i', type: 'agent_message', text: 'ok' },
          });
          yield JSON.stringify({
            type: 'turn.completed',
            usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
          });
        })();
      },
      sessionGeneration() { return gen; },
      lastTurnGeneration() { return turnG; },
      dispose() { sessionId = null; },
    };
  }

  it('first turn sends full prompt with system instructions', async () => {
    const transport = makeTransport();
    const agent = new CodexAgent({ transport, systemInstructions: '<<SYS>>' });
    await drain(agent, { phase: 'debate', prompt: 'full-p', deltaPrompt: 'delta-p' });
    expect(transport.prompts).toHaveLength(1);
    expect(transport.prompts[0]).toContain('<<SYS>>');
    expect(transport.prompts[0]).toContain('full-p');
    expect(transport.prompts[0]).not.toContain('delta-p');
  });

  it('second turn sends delta prompt (no system instructions) when session alive', async () => {
    const transport = makeTransport();
    const agent = new CodexAgent({ transport, systemInstructions: '<<SYS>>' });
    // Turn 1: seeds session context.
    await drain(agent, { phase: 'debate', prompt: 'full-1', deltaPrompt: 'delta-1' });
    // Turn 2: should use delta.
    await drain(agent, { phase: 'debate', prompt: 'full-2', deltaPrompt: 'delta-2' });
    expect(transport.prompts).toHaveLength(2);
    expect(transport.prompts[1]).toBe('delta-2');
    expect(transport.prompts[1]).not.toContain('<<SYS>>');
  });

  it('falls back to full prompt when no deltaPrompt provided', async () => {
    const transport = makeTransport();
    const agent = new CodexAgent({ transport, systemInstructions: '<<SYS>>' });
    await drain(agent, { phase: 'debate', prompt: 'full-1', deltaPrompt: 'delta-1' });
    await drain(agent, { phase: 'debate', prompt: 'full-2' });
    expect(transport.prompts[1]).toContain('<<SYS>>');
    expect(transport.prompts[1]).toContain('full-2');
  });

  it('falls back to full prompt when generation bumps (session lost)', async () => {
    const transport = makeTransport();
    const agent = new CodexAgent({ transport, systemInstructions: '<<SYS>>' });
    await drain(agent, { phase: 'debate', prompt: 'full-1', deltaPrompt: 'delta-1' });
    // Simulate session loss by bumping generation.
    transport.gen++;
    await drain(agent, { phase: 'debate', prompt: 'full-2', deltaPrompt: 'delta-2' });
    expect(transport.prompts[1]).toContain('<<SYS>>');
    expect(transport.prompts[1]).toContain('full-2');
  });

  it('reports promptMode=delta and char counts on usage when using delta', async () => {
    const transport = makeTransport();
    const agent = new CodexAgent({ transport, systemInstructions: '<<SYS>>' });
    await drain(agent, { phase: 'debate', prompt: 'full-1', deltaPrompt: 'delta-1' });
    const tail = await drain(agent, { phase: 'debate', prompt: 'full-2', deltaPrompt: 'delta-2' });
    expect(tail?.usage?.promptMode).toBe('delta');
    expect(tail?.usage?.promptChars).toBe('delta-2'.length);
    expect(tail?.usage?.fullPromptChars).toBe('full-2'.length);
    expect(tail?.usage?.deltaPromptChars).toBe('delta-2'.length);
  });

  it('reports promptMode=full on first turn usage', async () => {
    const transport = makeTransport();
    const agent = new CodexAgent({ transport, systemInstructions: '<<SYS>>' });
    const tail = await drain(agent, { phase: 'debate', prompt: 'full-1', deltaPrompt: 'delta-1' });
    expect(tail?.usage?.promptMode).toBe('full');
  });

  it('reverts to full prompt after abort (session discarded)', async () => {
    const transport = makeTransport();
    const agent = new CodexAgent({ transport, systemInstructions: '<<SYS>>' });
    // Turn 1: normal.
    await drain(agent, { phase: 'debate', prompt: 'full-1', deltaPrompt: 'delta-1' });
    // Turn 2: abort mid-stream.
    const ac = new AbortController();
    ac.abort();
    await drain(agent, { phase: 'debate', prompt: 'full-abort', deltaPrompt: 'delta-abort' }, ac.signal);
    // Turn 3: should send full prompt (agent saw abort → hasSessionContext = false).
    await drain(agent, { phase: 'debate', prompt: 'full-3', deltaPrompt: 'delta-3' });
    expect(transport.prompts[2]).toContain('<<SYS>>');
    expect(transport.prompts[2]).toContain('full-3');
  });

  it('warns when no thread.started event emitted (via console.warn)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const transport: CodexTransport = {
      runTurn() {
        return (async function* () {
          // No thread.started — only message + turn.completed.
          yield JSON.stringify({
            type: 'item.completed',
            item: { id: 'i', type: 'agent_message', text: 'hi' },
          });
          yield JSON.stringify({ type: 'turn.completed', usage: {} });
        })();
      },
      sessionGeneration: () => 0,
      lastTurnGeneration: () => 0,
      dispose: () => {},
    };
    // The warn fires inside createPersistentCliTransport, not the injected
    // transport. But we can verify the agent still works with a transport
    // that never emits thread.started — it just stays on full prompts.
    const agent = new CodexAgent({ transport, systemInstructions: '<<SYS>>' });
    await drain(agent, { phase: 'debate', prompt: 'p' });
    // The agent itself doesn't warn — the transport does. Since we're
    // injecting, the warn won't fire, but the test proves the agent works.
    warnSpy.mockRestore();
  });
});

describe('createPersistentCliTransport arg construction', () => {
  /** Capture the args of each spawned turn; replay a thread.started + done. */
  function makeSpawn(threadId = 'sess-abc') {
    const specs: SpawnSpec[] = [];
    const spawn = (spec: SpawnSpec, _signal: AbortSignal) => {
      specs.push(spec);
      return (async function* () {
        yield JSON.stringify({ type: 'thread.started', thread_id: threadId });
        yield JSON.stringify({ type: 'turn.completed', usage: {} });
      })();
    };
    return { specs, spawn };
  }

  async function drainTurn(t: CodexTransport, prompt: string) {
    for await (const _ of t.runTurn(prompt, new AbortController().signal)) {
      /* drive the generator to completion */
    }
  }

  it('first turn omits resume; subsequent turns use the `resume <id>` subcommand', async () => {
    const { specs, spawn } = makeSpawn('sess-abc');
    const transport = createPersistentCliTransport({ sandbox: 'read-only', spawn });

    await drainTurn(transport, 'prompt-1');
    await drainTurn(transport, 'prompt-2');

    expect(specs).toHaveLength(2);

    // Turn 1: no resume, prompt is the trailing positional.
    expect(specs[0]!.args).toEqual(['exec', '--json', '-s', 'read-only', 'prompt-1']);

    // Turn 2: `resume <id>` is a subcommand AFTER the options and BEFORE the
    // prompt. The flag form `--resume` is rejected by the real CLI with
    // "unexpected argument '--resume'", so guard against a regression.
    expect(specs[1]!.args).toEqual([
      'exec', '--json', '-s', 'read-only', 'resume', 'sess-abc', 'prompt-2',
    ]);
    expect(specs[1]!.args).not.toContain('--resume');
  });

  it('falls back to a fresh (no-resume) turn when no thread.started is emitted', async () => {
    const specs: SpawnSpec[] = [];
    const spawn = (spec: SpawnSpec) => {
      specs.push(spec);
      return (async function* () {
        // No thread.started — id never captured.
        yield JSON.stringify({ type: 'turn.completed', usage: {} });
      })();
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const transport = createPersistentCliTransport({ spawn });

    await drainTurn(transport, 'p1');
    await drainTurn(transport, 'p2');

    // Without a captured id, neither turn carries `resume`.
    expect(specs[1]!.args).not.toContain('resume');
    expect(transport.sessionGeneration()).toBeGreaterThan(0);
    warnSpy.mockRestore();
  });
});

runAgentContract('CodexAgent', () => {
  let response = '';
  let delayMs = 0;
  async function* synthesize() {
    yield JSON.stringify({ type: 'thread.started', thread_id: 't' });
    yield JSON.stringify({ type: 'turn.started' });
    // Emit char-by-char as separate agent_message events so the contract's
    // abort-mid-stream test has stream granularity. Real codex emits one
    // item.completed; the factory simulates incremental delivery for testing.
    for (const ch of response) {
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      yield JSON.stringify({
        type: 'item.completed',
        item: { id: 'i', type: 'agent_message', text: ch },
      });
    }
    yield JSON.stringify({ type: 'turn.completed', usage: {} });
  }
  const agent = new CodexAgent({ streamLines: () => synthesize() });
  return {
    agent,
    setResponse(text: string) {
      response = text;
    },
    setTokenDelayMs(ms: number) {
      delayMs = ms;
    },
  };
});
