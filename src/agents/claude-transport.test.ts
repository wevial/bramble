import { describe, it, expect } from 'vitest';
import {
  claudeTransportArgs,
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

  it('appends --allowed-tools when allowedTools is set', () => {
    const args = claudeTransportArgs({ allowedTools: ['Read', 'Grep', 'Glob'] });
    const idx = args.indexOf('--allowed-tools');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('Read Grep Glob');
  });

  it('omits --allowed-tools when allowedTools is empty or undefined', () => {
    expect(claudeTransportArgs({}).includes('--allowed-tools')).toBe(false);
    expect(claudeTransportArgs({ allowedTools: [] }).includes('--allowed-tools')).toBe(false);
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
  let generation = 0;
  let turnGeneration = 0;
  const transport: ClaudeTransport = {
    runTurn(prompt) {
      prompts.push(prompt);
      turnGeneration = generation;
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
    sessionGeneration() {
      return generation;
    },
    lastTurnGeneration() {
      return turnGeneration;
    },
    dispose() {
      disposed = true;
    },
  };
  return {
    transport,
    prompts,
    isDisposed: () => disposed,
    /** Simulate the child dying between turns (the transport would respawn). */
    bumpGeneration() {
      generation++;
    },
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

  // Reviewer-identified bug: if Claude exits after a successful turn but
  // before the next one, the transport silently respawns. hasSessionContext
  // mustn't stay "true" into a blank conversation.
  it('falls back to the full prompt if the transport respawned between turns', async () => {
    const recorder = makeRecordingTransport();
    const agent = new ClaudeAgent({ transport: recorder.transport });

    await drain(agent, 'full first', 'delta first');
    // Child died off-camera and will be respawned on the next runTurn.
    recorder.bumpGeneration();
    await drain(agent, 'full second', 'delta second');

    expect(recorder.prompts).toEqual(['full first', 'full second']);
  });

  // Reviewer-identified race: the child can exit cleanly right after the
  // successful `result` line; in the real transport the `close` handler
  // bumps `sessionGeneration()` before the agent records what it saw. The
  // agent must remember the generation the *turn* ran under, not whatever
  // the counter reads post-close, or the next turn sends a delta into a
  // freshly spawned blank process.
  it('falls back to full after a clean exit that bumps generation between turns', async () => {
    const recorder = makeRecordingTransport();
    const agent = new ClaudeAgent({ transport: recorder.transport });

    await drain(agent, 'full first', 'delta first');
    // Simulate the close-handler bump: turn ran at generation 0, then the
    // child exited cleanly and generation moved to 1 before the next turn.
    recorder.bumpGeneration();
    await drain(agent, 'full second', 'delta second');

    expect(recorder.prompts).toEqual(['full first', 'full second']);
  });

  it('dispose() releases the transport', () => {
    const { transport, isDisposed } = makeRecordingTransport();
    const agent = new ClaudeAgent({ transport });
    agent.dispose();
    expect(isDisposed()).toBe(true);
  });
});
