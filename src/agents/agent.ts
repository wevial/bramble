/**
 * Identifies a CLI *transport* (which subprocess we spawn). Persona IDs
 * (which can be arbitrary strings like 'security' or 'ux') are a separate
 * concept — see src/personas/personas.ts.
 */
export type AgentName = 'claude' | 'codex';

export type TurnContext = {
  /** Which loop phase this turn is for — drives the response schema. */
  phase: 'interview' | 'debate';
  /** Full self-contained prompt for one-shot agents or a fresh session. */
  prompt: string;
  /**
   * Smaller prompt for persistent agents that already have the earlier debate
   * in their conversation history.
   */
  deltaPrompt?: string;
};

export type Token = { text: string };

/**
 * Per-turn token accounting, normalized across claude + codex. `cacheReadTokens`
 * counts prompt tokens that hit the provider's prompt cache (cheap);
 * `cacheCreationTokens` is non-zero only on claude (OpenAI doesn't separate
 * creation from read — it folds cache writes into input_tokens).
 */
export type TurnUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Debug-only prompt mode used for this turn. */
  promptMode?: 'full' | 'delta';
  promptChars?: number;
  fullPromptChars?: number;
  deltaPromptChars?: number;
};

/**
 * Optional tail returned by an agent's stream generator. `raw` is the full
 * wire-format content (e.g. the complete JSON patch) used for parsing and
 * transcript persistence — distinct from the display tokens yielded during
 * streaming, which may be a commentary-only subset.
 */
export type StreamTail = { raw: string; usage?: TurnUsage };

export interface Agent {
  readonly name: AgentName;
  stream(
    ctx: TurnContext,
    signal: AbortSignal,
  ): AsyncGenerator<Token, StreamTail | void, void>;
  /** Release any long-lived resources (e.g. a persistent subprocess). */
  dispose?(): void;
}
