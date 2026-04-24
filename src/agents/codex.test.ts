import { describe, it, expect } from 'vitest';
import { CodexAgent } from './codex.js';
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
    const iter = agent.stream({ prompt: 'x' }, new AbortController().signal);
    while (true) {
      const r = await iter.next();
      if (r.done) {
        if (r.value) tail = r.value;
        break;
      }
      tokens.push(r.value.text);
    }
    expect(tokens.join('')).toContain('LGTM with a nit.');
    const parsed = JSON.parse(tail!.raw);
    expect(parsed.commentary).toBe('LGTM with a nit.');
    expect(parsed.verdict).toBe('LGTM');
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
    const iter = agent.stream({ prompt: 'x' }, new AbortController().signal);
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
