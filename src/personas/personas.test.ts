import { describe, it, expect } from 'vitest';
import {
  CLAUDE_PERSONA,
  CODEX_PERSONA,
  SPECIALIST_PERSONAS,
  findPersona,
  defaultPersonas,
} from './personas.js';

describe('persona registry', () => {
  it('exposes the two primaries', () => {
    expect(CLAUDE_PERSONA.scope).toBe('primary');
    expect(CODEX_PERSONA.scope).toBe('primary');
    expect(CLAUDE_PERSONA.transport).toBe('claude');
    expect(CODEX_PERSONA.transport).toBe('codex');
  });

  it('all built-in IDs are unique', () => {
    const ids = [
      CLAUDE_PERSONA.id,
      CODEX_PERSONA.id,
      ...SPECIALIST_PERSONAS.map(p => p.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every specialist declares a non-empty systemPrompt', () => {
    for (const p of SPECIALIST_PERSONAS) {
      expect(p.systemPrompt.length).toBeGreaterThan(20);
      expect(p.scope).toBe('specialist');
      expect(['claude', 'codex']).toContain(p.transport);
    }
  });

  it('findPersona resolves built-in IDs', () => {
    expect(findPersona('claude')?.label).toBe('Claude');
    expect(findPersona('codex')?.label).toBe('Codex');
    expect(findPersona('security')?.label).toBe('Security Critic');
    expect(findPersona('does-not-exist')).toBeUndefined();
  });

  it('defaultPersonas returns claude and codex in order', () => {
    const def = defaultPersonas();
    expect(def.map(p => p.id)).toEqual(['claude', 'codex']);
  });
});
