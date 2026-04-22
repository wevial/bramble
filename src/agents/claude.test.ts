import { describe, it, expect, vi } from 'vitest';
import { ClaudeAgent } from './claude.js';
import { runAgentContract } from './agent.contract.js';

describe('ClaudeAgent', () => {
  it('streams text tokens and returns parsed raw on completion', async () => {
    const fakeLines = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Proposing auth.' },
        },
      }),
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: {
            type: 'text_delta',
            text: '\n<patch>\n{"proposal":{"body":"X"}}\n</patch>',
          },
        },
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Proposing auth.\n<patch>\n{"proposal":{"body":"X"}}\n</patch>',
      }),
    ];

    async function* fakeStream() {
      for (const l of fakeLines) yield l;
    }

    const agent = new ClaudeAgent({ streamLines: () => fakeStream() });
    const tokens: string[] = [];
    let tail: { raw: string } | undefined;

    const iter = agent.stream({ prompt: 'test' }, new AbortController().signal);
    while (true) {
      const r = await iter.next();
      if (r.done) {
        if (r.value) tail = r.value;
        break;
      }
      tokens.push(r.value.text);
    }

    // Display tokens show only the commentary text, not JSON framing, because
    // that's what the model streams before the <patch> block.
    expect(tokens.join('')).toContain('Proposing auth.');
    expect(tokens.join('')).toContain('<patch>');
    expect(tail?.raw).toBeDefined();
    const parsed = JSON.parse(tail!.raw);
    expect(parsed.commentary).toBe('Proposing auth.');
    expect(parsed.proposal.body).toBe('X');
  });

  it('aborts when the signal fires', async () => {
    const ac = new AbortController();
    async function* slow() {
      for (let i = 0; i < 100; i++) {
        if (ac.signal.aborted) return;
        await new Promise(r => setTimeout(r, 5));
        yield JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: String(i) },
          },
        });
      }
    }

    const agent = new ClaudeAgent({ streamLines: () => slow() });
    const tokens: string[] = [];
    const iter = agent.stream({ prompt: 'test' }, ac.signal);
    setTimeout(() => ac.abort(), 30);
    while (true) {
      const r = await iter.next();
      if (r.done) break;
      tokens.push(r.value.text);
    }
    expect(tokens.length).toBeLessThan(20);
  });

  it('has name "claude"', () => {
    const agent = new ClaudeAgent({ streamLines: () => (async function* () {})() });
    expect(agent.name).toBe('claude');
  });
});

// Run the shared Agent contract against ClaudeAgent, synthesizing stream-json
// events from a configurable response string.
runAgentContract('ClaudeAgent', () => {
  let response = '';
  let delayMs = 0;
  async function* synthesize() {
    for (const ch of response) {
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
      yield JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: ch },
        },
      });
    }
    yield JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: response,
    });
  }
  const agent = new ClaudeAgent({ streamLines: () => synthesize() });
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
