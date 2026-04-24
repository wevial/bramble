import { describe, it, expect } from 'vitest';
import { parseCodexEvent } from './codex-events.js';

describe('parseCodexEvent', () => {
  it('returns null for unparseable lines', () => {
    expect(parseCodexEvent('')).toBeNull();
    expect(parseCodexEvent('junk')).toBeNull();
  });

  it('extracts agent_message item text', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_0', type: 'agent_message', text: 'Hi!' },
    });
    expect(parseCodexEvent(line)).toEqual({ kind: 'message', text: 'Hi!' });
  });

  it('flags turn.completed (end of response) without usage', () => {
    const line = JSON.stringify({ type: 'turn.completed' });
    expect(parseCodexEvent(line)).toEqual({ kind: 'turnDone', usage: undefined });
  });

  it('surfaces cache-aware usage on turn.completed when present', () => {
    const line = JSON.stringify({
      type: 'turn.completed',
      usage: {
        input_tokens: 1500,
        cached_input_tokens: 1200,
        output_tokens: 42,
      },
    });
    expect(parseCodexEvent(line)).toEqual({
      kind: 'turnDone',
      usage: {
        inputTokens: 1500,
        outputTokens: 42,
        cacheReadTokens: 1200,
        cacheCreationTokens: 0,
      },
    });
  });

  it('skips other event types', () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: 'x' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'tool_call', name: 'read' },
      }),
    ];
    for (const l of lines) expect(parseCodexEvent(l)).toBeNull();
  });
});
