import { z } from 'zod';
import type { TurnUsage } from './agent.js';

export type CodexEvent =
  | { kind: 'message'; text: string }
  | { kind: 'turnDone'; usage: TurnUsage | undefined };

const AgentMessageSchema = z
  .object({
    type: z.literal('item.completed'),
    item: z
      .object({
        type: z.literal('agent_message'),
        text: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

const UsageSchema = z
  .object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    cached_input_tokens: z.number().optional(),
  })
  .passthrough();

const TurnCompletedSchema = z
  .object({
    type: z.literal('turn.completed'),
    usage: UsageSchema.optional(),
  })
  .passthrough();

export function parseCodexEvent(line: string): CodexEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const msg = AgentMessageSchema.safeParse(obj);
  if (msg.success) return { kind: 'message', text: msg.data.item.text };
  const turn = TurnCompletedSchema.safeParse(obj);
  if (turn.success) {
    return {
      kind: 'turnDone',
      usage: turn.data.usage
        ? {
            inputTokens: turn.data.usage.input_tokens ?? 0,
            outputTokens: turn.data.usage.output_tokens ?? 0,
            cacheReadTokens: turn.data.usage.cached_input_tokens ?? 0,
            cacheCreationTokens: 0,
          }
        : undefined,
    };
  }
  return null;
}
