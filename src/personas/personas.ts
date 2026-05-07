import type { AgentName } from '../agents/agent.js';

/**
 * Stable identifier for a participant in a session. The two primary
 * debaters use the IDs `'claude'` and `'codex'` for backward compatibility
 * with existing transcripts, but specialists may use any string.
 */
export type PersonaId = string;

export type Persona = {
  /** Stable identifier; appears in transcripts and state. */
  id: PersonaId;
  /** Display label, e.g. "Security Critic". */
  label: string;
  /** Single-character glyph for the conversation pane and participants box. */
  glyph: string;
  /** Hex color or named color used in the UI for this persona. */
  color: string;
  /**
   * 'primary' personas are the spec authors who edit the doc; 'specialist'
   * personas are critics/reviewers. Today both roles share the same wire
   * format and turn structure — the scope is informational, but it lets the
   * UI group them differently and lets future features (e.g. specialist-only
   * read access) hang off this.
   */
  scope: 'primary' | 'specialist';
  /** Which CLI transport backs this persona. */
  transport: AgentName;
  /**
   * Persona-specific addendum to the base system instructions. Appended
   * verbatim, so write it as a 1-3 sentence character brief. Stable across
   * the session so it stays cacheable.
   */
  systemPrompt: string;
};

export const CLAUDE_PERSONA: Persona = {
  id: 'claude',
  label: 'Claude',
  glyph: '☀',
  color: '#FF8C42',
  scope: 'primary',
  transport: 'claude',
  systemPrompt: '',
};

export const CODEX_PERSONA: Persona = {
  id: 'codex',
  label: 'Codex',
  glyph: '⊛',
  color: 'cyan',
  scope: 'primary',
  transport: 'codex',
  systemPrompt: '',
};

export const SPECIALIST_PERSONAS: Persona[] = [
  {
    id: 'security',
    label: 'Security Critic',
    glyph: '◇',
    color: '#FF6B6B',
    scope: 'specialist',
    transport: 'claude',
    systemPrompt:
      'You are the Security Critic. Push hard on the threat model, authn/authz boundaries, secrets handling, supply-chain risk, input validation, abuse vectors, and what the spec is silent about. Insist on explicit non-goals around security. Reject hand-waving about "we use HTTPS" — name the specific risks and how the spec addresses them.',
  },
  {
    id: 'perf',
    label: 'Perf Critic',
    glyph: '◈',
    color: '#FFD43B',
    scope: 'specialist',
    transport: 'codex',
    systemPrompt:
      'You are the Performance Critic. Push for explicit SLOs (p50/p95/p99 latency, throughput targets), hot-path identification, scaling assumptions, and failure modes under load. Reject vague performance language. Demand the spec name the bottleneck class (CPU / network / IO / lock contention) before claiming "fast".',
  },
  {
    id: 'ux',
    label: 'UX Critic',
    glyph: '◉',
    color: '#7AA2FF',
    scope: 'specialist',
    transport: 'claude',
    systemPrompt:
      'You are the UX Critic. Push for clear user flows, error states, empty states, edge cases (network drop, slow response, partial data), and accessibility considerations. Reject specs that describe a happy path without naming what failure looks like to the user.',
  },
  {
    id: 'naming',
    label: 'Naming Pedant',
    glyph: '◬',
    color: '#BFA3FF',
    scope: 'specialist',
    transport: 'codex',
    systemPrompt:
      'You are the Naming Pedant. Push for clear, consistent, unambiguous names for entities, fields, commands, flags, and concepts. Flag synonym drift ("user" vs "account" vs "principal"), abbreviations that hide meaning, and names that lie about what they do. Be the person who notices the API would be 30% better with renames.',
  },
  {
    id: 'ops',
    label: 'Ops Critic',
    glyph: '◊',
    color: '#8CCF7E',
    scope: 'specialist',
    transport: 'claude',
    systemPrompt:
      'You are the Operations Critic. Push for observability (logs / metrics / traces), runbook hooks, deploy/rollback story, config surface, dependency failure modes, and dead-tree maintenance burden. Reject specs that describe steady-state behavior without naming how an operator diagnoses or recovers from failure.',
  },
];

export const ALL_PERSONAS: Persona[] = [
  CLAUDE_PERSONA,
  CODEX_PERSONA,
  ...SPECIALIST_PERSONAS,
];

export function findPersona(id: PersonaId): Persona | undefined {
  return ALL_PERSONAS.find(p => p.id === id);
}

export function defaultPersonas(): Persona[] {
  return [CLAUDE_PERSONA, CODEX_PERSONA];
}
