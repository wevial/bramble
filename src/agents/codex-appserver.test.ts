import { describe, it, expect } from 'bun:test';
import { translateNotification } from './codex-appserver.js';
import { parseCodexEvent } from './codex-events.js';

const freshState = () => ({
  deltaItems: new Set<string>(),
  lastUsage: null as { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number } | null,
});

describe('translateNotification', () => {
  it('translates agent message deltas into exec-style item.completed lines', () => {
    const state = freshState();
    const t = translateNotification(
      'item/agentMessage/delta',
      { itemId: 'item_1', delta: 'hel' },
      state,
    );
    expect(t.done).toBeUndefined();
    const evt = parseCodexEvent(t.line!);
    expect(evt).toEqual({ kind: 'message', text: 'hel' });
    expect(state.deltaItems.has('item_1')).toBe(true);
  });

  it('suppresses item/completed full text for items already streamed via deltas', () => {
    const state = freshState();
    translateNotification('item/agentMessage/delta', { itemId: 'item_1', delta: 'hello' }, state);
    const t = translateNotification(
      'item/completed',
      { item: { id: 'item_1', type: 'agentMessage', text: 'hello' } },
      state,
    );
    expect(t.line).toBeUndefined();
  });

  it('emits full text on item/completed when no deltas were seen', () => {
    const state = freshState();
    const t = translateNotification(
      'item/completed',
      { item: { id: 'item_9', type: 'agentMessage', text: 'full reply' } },
      state,
    );
    const evt = parseCodexEvent(t.line!);
    expect(evt).toEqual({ kind: 'message', text: 'full reply' });
  });

  it('drops malformed deltas and lets item/completed provide the full text', () => {
    const state = freshState();
    const t = translateNotification(
      'item/agentMessage/delta',
      { itemId: 'item_1', delta: 42 },
      state,
    );
    expect(t).toEqual({});
    expect(state.deltaItems.has('item_1')).toBe(false);
    // Full text still arrives via item/completed since no delta was emitted.
    const done = translateNotification(
      'item/completed',
      { item: { id: 'item_1', type: 'agentMessage', text: 'recovered' } },
      state,
    );
    expect(parseCodexEvent(done.line!)).toEqual({ kind: 'message', text: 'recovered' });
  });

  it('ignores non-agentMessage items', () => {
    const state = freshState();
    const t = translateNotification(
      'item/completed',
      { item: { id: 'c1', type: 'commandExecution', command: 'ls' } },
      state,
    );
    expect(t.line).toBeUndefined();
    expect(t.done).toBeUndefined();
  });

  it('records token usage and folds it into turn.completed', () => {
    const state = freshState();
    translateNotification(
      'thread/tokenUsage/updated',
      {
        tokenUsage: {
          total: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 9 },
          last: { inputTokens: 60, cachedInputTokens: 40, outputTokens: 5 },
        },
      },
      state,
    );
    const t = translateNotification(
      'turn/completed',
      { turn: { id: 't1', status: 'completed', error: null } },
      state,
    );
    expect(t.done).toBe(true);
    const evt = parseCodexEvent(t.line!);
    expect(evt).toEqual({
      kind: 'turnDone',
      usage: {
        // parseCodexEvent normalizes: inputTokens = input - cached.
        inputTokens: 20,
        outputTokens: 5,
        cacheReadTokens: 40,
        cacheCreationTokens: 0,
      },
    });
  });

  it('surfaces interrupted (and any non-completed) turns as errors', () => {
    const state = freshState();
    const t = translateNotification(
      'turn/completed',
      { turn: { id: 't1', status: 'interrupted', error: null } },
      state,
    );
    expect(t.done).toBe(true);
    expect(t.error).toBe('codex turn interrupted');
    expect(t.line).toBeUndefined();
  });

  it('surfaces failed turns as errors', () => {
    const state = freshState();
    const t = translateNotification(
      'turn/completed',
      { turn: { id: 't1', status: 'failed', error: { message: 'model not supported' } } },
      state,
    );
    expect(t.done).toBe(true);
    expect(t.error).toBe('model not supported');
    expect(t.line).toBeUndefined();
  });

  it('passes through unrelated notifications silently', () => {
    const state = freshState();
    for (const method of [
      'thread/started',
      'turn/started',
      'item/started',
      'account/rateLimits/updated',
      'item/reasoning/textDelta',
    ]) {
      const t = translateNotification(method, {}, state);
      expect(t).toEqual({});
    }
  });
});
