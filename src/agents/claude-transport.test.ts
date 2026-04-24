import { describe, it, expect } from 'vitest';
import {
  encodeUserMessage,
  isTurnTerminatorLine,
} from './claude-transport.js';
import { ClaudeAgent } from './claude.js';
import type { ClaudeTransport } from './claude-transport.js';

describe('claude-transport helpers', () => {
  it('encodes a user message in the CLI stream-json input shape', () => {
    const line = encodeUserMessage('hello');
    expect(line.endsWith('\n')).toBe(true);
    const obj = JSON.parse(line.trim());
    expect(obj).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      },
    });
  });

  it('flags only `type: "result"` lines as turn terminators', () => {
    expect(
      isTurnTerminatorLine(JSON.stringify({ type: 'result', subtype: 'success' })),
    ).toBe(true);
    expect(
      isTurnTerminatorLine(JSON.stringify({ type: 'stream_event' })),
    ).toBe(false);
    expect(isTurnTerminatorLine('')).toBe(false);
    expect(isTurnTerminatorLine('not json')).toBe(false);
  });
});

/**
 * Fake transport that synthesizes a stream-json turn from a pre-canned
 * response, while recording every prompt it sees so the test can verify the
 * transport is reused across turns.
 */
function makeRecordingTransport() {
  const prompts: string[] = [];
  let disposed = false;
  const transport: ClaudeTransport = {
    runTurn(prompt) {
      prompts.push(prompt);
      const text = `response to ${prompt}`;
      return (async function* () {
        yield JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text },
          },
        });
        yield JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: text,
          usage: {
            input_tokens: 10,
            output_tokens: 2,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        });
      })();
    },
    dispose() {
      disposed = true;
    },
  };
  return {
    transport,
    prompts,
    isDisposed: () => disposed,
  };
}

async function drain(agent: ClaudeAgent, prompt: string, deltaPrompt?: string) {
  const ac = new AbortController();
  const out: string[] = [];
  const iter = agent.stream({ prompt, deltaPrompt }, ac.signal);
  while (true) {
    const r = await iter.next();
    if (r.done) return { text: out.join(''), tail: r.value };
    out.push(r.value.text);
  }
}

describe('ClaudeAgent with a long-lived transport', () => {
  it('reuses the same transport across sequential turns', async () => {
    const { transport, prompts } = makeRecordingTransport();
    const agent = new ClaudeAgent({ transport });

    await drain(agent, 'first prompt');
    await drain(agent, 'second prompt');
    await drain(agent, 'third prompt');

    expect(prompts).toEqual(['first prompt', 'second prompt', 'third prompt']);
  });

  it('sends only ctx.prompt over the wire — system protocol goes to --append-system-prompt', async () => {
    const { transport, prompts } = makeRecordingTransport();
    const agent = new ClaudeAgent({ transport });
    await drain(agent, 'bare turn text');
    expect(prompts[0]).toBe('bare turn text');
    // No embedded "DEFAULT_PROTOCOL" / "<patch>" framing smuggled in alongside the prompt.
    expect(prompts[0]).not.toMatch(/<patch>/);
  });

  it('uses delta prompts after the persistent session has been seeded', async () => {
    const { transport, prompts } = makeRecordingTransport();
    const agent = new ClaudeAgent({ transport });

    await drain(agent, 'full first', 'delta first');
    await drain(agent, 'full second', 'delta second');

    expect(prompts).toEqual(['full first', 'delta second']);
  });

  it('keeps legacy per-turn streamLines on the full prompt', async () => {
    const prompts: string[] = [];
    const agent = new ClaudeAgent({
      streamLines(prompt) {
        prompts.push(prompt);
        return (async function* () {
          yield JSON.stringify({
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: 'ok',
          });
        })();
      },
    });

    await drain(agent, 'full first', 'delta first');
    await drain(agent, 'full second', 'delta second');

    expect(prompts).toEqual(['full first', 'full second']);
  });

  it('dispose() releases the transport', () => {
    const { transport, isDisposed } = makeRecordingTransport();
    const agent = new ClaudeAgent({ transport });
    agent.dispose();
    expect(isDisposed()).toBe(true);
  });
});
