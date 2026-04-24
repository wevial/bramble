import { z } from 'zod';
import type { TurnUsage } from './agent.js';

export type ClaudeEvent =
  | { kind: 'text'; text: string }
  | { kind: 'result'; result: string; isError: boolean; usage: TurnUsage | undefined };

const TextDeltaSchema = z
  .object({
    type: z.literal('stream_event'),
    event: z.object({
      type: z.literal('content_block_delta'),
      delta: z.object({
        type: z.literal('text_delta'),
        text: z.string(),
      }),
    }),
  })
  .passthrough();

const UsageSchema = z
  .object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
    cache_creation_input_tokens: z.number().optional(),
  })
  .passthrough();

const ResultSchema = z
  .object({
    type: z.literal('result'),
    result: z.string(),
    is_error: z.boolean().optional(),
    usage: UsageSchema.optional(),
  })
  .passthrough();

export function parseClaudeEvent(line: string): ClaudeEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const td = TextDeltaSchema.safeParse(obj);
  if (td.success) {
    return { kind: 'text', text: td.data.event.delta.text };
  }
  const r = ResultSchema.safeParse(obj);
  if (r.success) {
    return {
      kind: 'result',
      result: r.data.result,
      isError: r.data.is_error === true,
      usage: r.data.usage
        ? {
            inputTokens: r.data.usage.input_tokens ?? 0,
            outputTokens: r.data.usage.output_tokens ?? 0,
            cacheReadTokens: r.data.usage.cache_read_input_tokens ?? 0,
            cacheCreationTokens: r.data.usage.cache_creation_input_tokens ?? 0,
          }
        : undefined,
    };
  }
  return null;
}
