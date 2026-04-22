import { z } from 'zod';

export type CodexEvent =
  | { kind: 'message'; text: string }
  | { kind: 'turnDone' };

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

const TurnCompletedSchema = z
  .object({
    type: z.literal('turn.completed'),
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
  if (turn.success) return { kind: 'turnDone' };
  return null;
}
