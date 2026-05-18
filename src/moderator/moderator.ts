import type { Agent } from '../agents/agent.js';
import type { Persona, PersonaId } from '../personas/personas.js';
import type { State } from '../orchestrator/state.js';
import { moderatorPrompt } from './prompt.js';
import { parseModeratorPick } from './parse.js';
import { nextSpeaker } from '../orchestrator/scheduler.js';

export type ModeratorPick = {
  next: PersonaId;
  reason: string;
  /** True when the moderator's choice was overridden (parse fail / cap hit). */
  fallback?: boolean;
};

export interface Moderator {
  pick(state: State, signal?: AbortSignal): Promise<ModeratorPick>;
  dispose?(): void;
}

/**
 * Default scheduler dressed up as a Moderator. Used when the user opts out
 * of the LLM moderator, and as the fallback when the LLM moderator fails or
 * gets stuck on one persona.
 */
export class RoundRobinModerator implements Moderator {
  async pick(state: State, _signal?: AbortSignal): Promise<ModeratorPick> {
    return { next: nextSpeaker(state), reason: '' };
  }
}

export type LLMModeratorOptions = {
  agent: Agent;
  personas: Persona[];
  /** Max turns of context to include in the prompt. Default 5. */
  contextWindow?: number;
  /**
   * If the moderator picks the same persona this many times in a row, fall
   * back to round-robin for one turn to break the loop. Default 2.
   */
  consecutivePickCap?: number;
};

/**
 * Asks an LLM (typically a small/cheap one) to pick the next speaker given
 * recent context. Falls back to round-robin on parse failure or when the
 * same persona is picked too many times in a row.
 */
export class LLMModerator implements Moderator {
  private readonly agent: Agent;
  private readonly personas: Persona[];
  private readonly contextWindow: number;
  private readonly cap: number;
  private lastPick: PersonaId | null = null;
  private consecutiveCount = 0;

  constructor(opts: LLMModeratorOptions) {
    this.agent = opts.agent;
    this.personas = opts.personas;
    this.contextWindow = opts.contextWindow ?? 5;
    this.cap = opts.consecutivePickCap ?? 1;
  }

  async pick(state: State, signal?: AbortSignal): Promise<ModeratorPick> {
    const ids = state.activePersonas ?? this.personas.map(p => p.id);

    // Fast path: with only 2 personas, round-robin is the only sensible
    // schedule — skip the LLM call entirely.
    if (ids.length <= 2) {
      const next = nextSpeaker(state);
      this.recordPick(next);
      return { next, reason: '', fallback: true };
    }

    // Rule-based fast path: in interview, ensure every persona speaks before
    // the LLM decides ordering. The runner's neverSpoken guard covers primaries;
    // this extends the same policy to specialists so no persona is skipped.
    // Only applies once the interview has started (non-empty log) — the very
    // first speaker is selected by the runner's own logic, not the moderator.
    if (state.phase === 'interview' && state.interview.length > 0) {
      const spoken = new Set(state.interview.map(t => t.speaker));
      const unspoken = ids.filter(id => !spoken.has(id));
      if (unspoken.length > 0) {
        const next = unspoken[0]!;
        this.recordPick(next);
        return { next, reason: `${next} hasn't spoken yet`, fallback: true };
      }
    }

    const personaSet = this.personas.filter(p => ids.includes(p.id));
    const prompt = moderatorPrompt({
      state,
      personas: personaSet,
      contextWindow: this.contextWindow,
    });

    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    let raw = '';
    try {
      const iter = this.agent.stream(
        { phase: 'debate', prompt },
        ctrl.signal,
      );
      while (true) {
        const r = await iter.next();
        if (r.done) {
          if (r.value) raw = r.value.raw;
          break;
        }
        // Tokens accumulate via the tail's `raw`; nothing to do per token.
      }
    } catch {
      /* aborts/parse failures fall through to the parser */
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
    }

    const parsed = parseModeratorPick(raw, ids);
    if (!parsed) {
      // Parse failed — fall back to round-robin.
      const fallback = nextSpeaker(state);
      this.recordPick(fallback);
      return { next: fallback, reason: '', fallback: true };
    }

    // Consecutive-pick cap: prevent one specialist monopolizing the floor.
    if (parsed.next === this.lastPick && this.consecutiveCount >= this.cap) {
      const order = ids;
      const idx = order.indexOf(parsed.next);
      const wrapped = order[(idx + 1) % order.length] ?? parsed.next;
      this.recordPick(wrapped);
      return {
        next: wrapped,
        reason: `${parsed.reason} (rotated to break streak)`,
        fallback: true,
      };
    }

    this.recordPick(parsed.next);
    return { next: parsed.next, reason: parsed.reason };
  }

  dispose(): void {
    this.agent.dispose?.();
  }

  private recordPick(id: PersonaId): void {
    if (id === this.lastPick) this.consecutiveCount += 1;
    else {
      this.lastPick = id;
      this.consecutiveCount = 1;
    }
  }
}
