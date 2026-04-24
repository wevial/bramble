import { describe, it, expect } from 'vitest';
import { parseClaudeEvent } from './claude-events.js';

describe('parseClaudeEvent', () => {
  it('returns null for unparseable lines', () => {
    expect(parseClaudeEvent('')).toBeNull();
    expect(parseClaudeEvent('not json')).toBeNull();
  });

  it('extracts text_delta tokens', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      },
    });
    expect(parseClaudeEvent(line)).toEqual({ kind: 'text', text: 'Hello' });
  });

  it('extracts the final result text', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Hi! How can I help?',
      duration_ms: 1000,
    });
    expect(parseClaudeEvent(line)).toEqual({
      kind: 'result',
      result: 'Hi! How can I help?',
      isError: false,
      usage: undefined,
    });
  });

  it('surfaces cache-aware usage on the result when present', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'hi',
      usage: {
        input_tokens: 20,
        output_tokens: 5,
        cache_read_input_tokens: 1200,
        cache_creation_input_tokens: 300,
      },
    });
    const evt = parseClaudeEvent(line);
    expect(evt).toEqual({
      kind: 'result',
      result: 'hi',
      isError: false,
      usage: {
        inputTokens: 20,
        outputTokens: 5,
        cacheReadTokens: 1200,
        cacheCreationTokens: 300,
      },
    });
  });

  it('flags error results', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'error',
      is_error: true,
      result: 'Something went wrong',
    });
    expect(parseClaudeEvent(line)).toEqual({
      kind: 'result',
      result: 'Something went wrong',
      isError: true,
    });
  });

  it('skips events we do not care about', () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x' }),
      JSON.stringify({ type: 'system', subtype: 'hook_started' }),
      JSON.stringify({ type: 'stream_event', event: { type: 'message_start' } }),
      JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start' } }),
      JSON.stringify({ type: 'stream_event', event: { type: 'message_stop' } }),
      JSON.stringify({ type: 'assistant', message: {} }),
      JSON.stringify({ type: 'rate_limit_event', rate_limit_info: {} }),
    ];
    for (const l of lines) {
      expect(parseClaudeEvent(l)).toBeNull();
    }
  });
});
