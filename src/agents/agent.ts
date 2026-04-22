export type AgentName = 'claude' | 'codex';

export type TurnContext = {
  prompt: string;
};

export type Token = { text: string };

/**
 * Optional tail returned by an agent's stream generator. `raw` is the full
 * wire-format content (e.g. the complete JSON patch) used for parsing and
 * transcript persistence — distinct from the display tokens yielded during
 * streaming, which may be a commentary-only subset.
 */
export type StreamTail = { raw: string };

export interface Agent {
  readonly name: AgentName;
  stream(
    ctx: TurnContext,
    signal: AbortSignal,
  ): AsyncGenerator<Token, StreamTail | void, void>;
}
