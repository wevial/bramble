import type { TurnUsage } from './agent.js';

export type CodexEvent =
  | { kind: 'message'; text: string }
  | { kind: 'turnDone'; usage: TurnUsage | undefined };

/**
 * Parse a single JSONL line from the Codex CLI's `--json` output.
 *
 * Uses manual type checks instead of Zod schemas — `item.completed` events
 * fire on every message chunk, and avoiding Zod's validation overhead keeps
 * the per-line cost near zero.
 */
export function parseCodexEvent(line: string): CodexEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;

  // Agent message — the primary content event.
  if (obj.type === 'item.completed' && typeof obj.item === 'object' && obj.item !== null) {
    const item = obj.item as Record<string, unknown>;
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      return { kind: 'message', text: item.text };
    }
    return null;
  }

  // Turn completed — fires once at the end, carries usage stats.
  if (obj.type === 'turn.completed') {
    const usage = typeof obj.usage === 'object' && obj.usage !== null
      ? obj.usage as Record<string, unknown>
      : undefined;
    return {
      kind: 'turnDone',
      usage: usage
        ? (() => {
            // Codex `input_tokens` already includes `cached_input_tokens`.
            // Normalize to the claude convention where `inputTokens` is
            // uncached-only, so both agents share one semantic for downstream
            // math (denominator = inputTokens + cacheReadTokens + cacheCreationTokens).
            const rawInput = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
            const cached = typeof usage.cached_input_tokens === 'number' ? usage.cached_input_tokens : 0;
            return {
              inputTokens: Math.max(0, rawInput - cached),
              outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
              cacheReadTokens: cached,
              cacheCreationTokens: 0,
            };
          })()
        : undefined,
    };
  }

  return null;
}
