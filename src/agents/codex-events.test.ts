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

  it('flags turn.completed (end of response)', () => {
    const line = JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 100 },
    });
    expect(parseCodexEvent(line)).toEqual({ kind: 'turnDone' });
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
