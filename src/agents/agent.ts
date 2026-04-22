export type AgentName = 'claude' | 'codex';

export type TurnContext = {
  prompt: string;
};

export type Token = { text: string };

export interface Agent {
  readonly name: AgentName;
  stream(ctx: TurnContext, signal: AbortSignal): AsyncIterable<Token>;
}
