import type { TurnUsage } from './agent.js';

export type ClaudeEvent =
  | { kind: 'text'; text: string }
  | { kind: 'result'; result: string; isError: boolean; usage: TurnUsage | undefined };

/**
 * Parse a single JSONL line from the Claude CLI's stream-json output.
 *
 * Uses manual type checks instead of Zod schemas on the hot path — text
 * deltas fire hundreds of times per turn, and avoiding Zod's validation
 * overhead keeps the per-line cost near zero.
 */
export function parseClaudeEvent(line: string): ClaudeEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;

  // Hot path: text delta — the most frequent event type.
  if (
    obj.type === 'stream_event' &&
    typeof obj.event === 'object' && obj.event !== null
  ) {
    const evt = obj.event as Record<string, unknown>;
    if (
      evt.type === 'content_block_delta' &&
      typeof evt.delta === 'object' && evt.delta !== null
    ) {
      const delta = evt.delta as Record<string, unknown>;
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        return { kind: 'text', text: delta.text };
      }
    }
    return null;
  }

  // Cold path: result — fires once at the end of a turn.
  if (obj.type === 'result' && typeof obj.result === 'string') {
    const usage = typeof obj.usage === 'object' && obj.usage !== null
      ? obj.usage as Record<string, unknown>
      : undefined;
    return {
      kind: 'result',
      result: obj.result,
      isError: obj.is_error === true,
      usage: usage
        ? {
            inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
            outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
            cacheReadTokens: typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0,
            cacheCreationTokens: typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0,
          }
        : undefined,
    };
  }

  return null;
}
