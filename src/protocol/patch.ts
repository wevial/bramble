import { z } from 'zod';

const AgentOutputSchema = z.object({
  commentary: z.string(),
  proposal: z
    .object({ body: z.string() })
    .nullish()
    .transform(p => p ?? null),
  verdict: z
    .enum(['LGTM', 'counter'])
    .nullish()
    .transform(v => v ?? null),
});

export type AgentOutput = z.infer<typeof AgentOutputSchema>;

export type ParseResult =
  | { ok: true; value: AgentOutput }
  | { ok: false; error: string };

export type ParseOptions = {
  /** If parsing fails, return {commentary: raw, proposal: null, verdict: null} instead. */
  fallbackToCommentary?: boolean;
};

export function parseAgentOutput(raw: string, opts: ParseOptions = {}): ParseResult {
  const candidate = extractJsonObject(raw) ?? raw;
  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch (e) {
    return fallback(raw, opts, `invalid JSON: ${(e as Error).message}`);
  }
  const parsed = AgentOutputSchema.safeParse(json);
  if (!parsed.success) {
    return fallback(raw, opts, parsed.error.message);
  }
  return { ok: true, value: parsed.data };
}

function fallback(raw: string, opts: ParseOptions, error: string): ParseResult {
  if (opts.fallbackToCommentary) {
    return {
      ok: true,
      value: { commentary: raw, proposal: null, verdict: null },
    };
  }
  return { ok: false, error };
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return null; // whole string is already JSON candidate
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return trimmed.slice(start, end + 1);
}
