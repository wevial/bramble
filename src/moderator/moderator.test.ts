import { describe, it, expect } from 'vitest';
import {
  RoundRobinModerator,
  LLMModerator,
  type Moderator,
} from './moderator.js';
import { initialState } from '../orchestrator/state.js';
import type { Agent, StreamTail, Token, TurnContext } from '../agents/agent.js';
import {
  CLAUDE_PERSONA,
  CODEX_PERSONA,
  SPECIALIST_PERSONAS,
} from '../personas/personas.js';

const SECURITY = SPECIALIST_PERSONAS.find(p => p.id === 'security')!;

function fakeAgent(rawResponses: string[]): Agent {
  let i = 0;
  return {
    name: 'codex',
    async *stream(_ctx: TurnContext): AsyncGenerator<Token, StreamTail | void, void> {
      const raw = rawResponses[i++ % rawResponses.length] ?? '';
      yield { text: raw };
      return { raw };
    },
  };
}

describe('RoundRobinModerator', () => {
  it('returns the round-robin pick with no reason', async () => {
    const m: Moderator = new RoundRobinModerator();
    const state = initialState('x', undefined, ['claude', 'codex']);
    const r = await m.pick(state);
    expect(r.next).toBe('claude');
    expect(r.reason).toBe('');
  });
});

describe('LLMModerator', () => {
  const personas = [CLAUDE_PERSONA, CODEX_PERSONA, SECURITY];

  it('uses the agent\'s pick when JSON is valid', async () => {
    const agent = fakeAgent([
      '{"next":"security","reason":"checking the auth section"}',
    ]);
    const m = new LLMModerator({ agent, personas });
    const state = initialState('x', undefined, ['claude', 'codex', 'security']);
    const r = await m.pick(state);
    expect(r.next).toBe('security');
    expect(r.reason).toBe('checking the auth section');
    expect(r.fallback).toBeUndefined();
  });

  it('falls back to round-robin on parse failure', async () => {
    const agent = fakeAgent(['totally not json']);
    const m = new LLMModerator({ agent, personas });
    const state = initialState('x', undefined, ['claude', 'codex', 'security']);
    const r = await m.pick(state);
    expect(r.next).toBe('claude'); // round-robin pick on empty log
    expect(r.fallback).toBe(true);
  });

  it('rotates off a persona after the consecutive-pick cap', async () => {
    const agent = fakeAgent([
      '{"next":"security","reason":"r1"}',
      '{"next":"security","reason":"r2"}',
      '{"next":"security","reason":"r3"}',
    ]);
    const m = new LLMModerator({
      agent,
      personas,
      consecutivePickCap: 2,
    });
    const state = initialState('x', undefined, ['claude', 'codex', 'security']);
    const a = await m.pick(state);
    const b = await m.pick(state);
    const c = await m.pick(state);
    expect(a.next).toBe('security');
    expect(b.next).toBe('security');
    // Third call hits the cap and rotates to the next persona.
    expect(c.next).not.toBe('security');
    expect(c.fallback).toBe(true);
  });
});
