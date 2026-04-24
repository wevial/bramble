export type AgentName = 'claude' | 'codex';

export type TurnContext = {
  prompt: string;
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
}
