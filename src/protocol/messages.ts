import { z } from 'zod';

export type Edit = { find: string; replace: string };
export type InterviewMessage = {
  commentary: string;
  question: string | null;
  ready: boolean;
};
export type DebateMessage = {
  commentary: string;
  edits: Edit[];
  verdict: 'continue' | 'lgtm';
};
export type CriteriaMessage = {
  commentary: string;
  proposed: string[];
};

const EditSchema = z.object({
  find: z.string(),
  replace: z.string(),
});

const InterviewMessageSchema = z.object({
  commentary: z.string(),
  question: z
    .string()
    .nullish()
    .transform(q => q ?? null),
  ready: z.boolean(),
});

const DebateMessageSchema = z.object({
  commentary: z.string(),
  edits: z
    .array(EditSchema)
    .nullish()
    .transform(e => e ?? []),
  verdict: z.enum(['continue', 'lgtm']),
});

const CriteriaMessageSchema = z.object({
  commentary: z.string(),
  proposed: z
    .array(z.string())
    .nullish()
    .transform(p => p ?? []),
});

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseInterviewMessage(
  raw: string,
): ParseResult<InterviewMessage> {
  return parseWithSchema(raw, InterviewMessageSchema);
}

export function parseDebateMessage(raw: string): ParseResult<DebateMessage> {
  return parseWithSchema(raw, DebateMessageSchema);
}

export function parseCriteriaMessage(raw: string): ParseResult<CriteriaMessage> {
  return parseWithSchema(raw, CriteriaMessageSchema);
}

function parseWithSchema<T extends z.ZodTypeAny>(
  raw: string,
  schema: T,
): ParseResult<z.output<T>> {
  const candidate = extractJsonObject(raw) ?? raw;
  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  return { ok: true, value: parsed.data };
}

function extractJsonObject(raw: string): string | null {
  // Strip code fences first — agents often wrap JSON in ```json ... ``` even
  // though they're told not to.
  const noFences = raw
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  // Find the first '{' and walk forward with a brace-depth counter that
  // respects strings and escapes. This handles trailing prose after the
  // JSON, multiple top-level objects (we take the first), and nested
  // objects that simple lastIndexOf('}') would mis-bracket.
  const start = noFences.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < noFences.length; i++) {
    const ch = noFences[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return noFences.slice(start, i + 1);
    }
  }
  return null;
}

export type RejectedEdit = {
  kind: 'no_match' | 'ambiguous';
  edit: Edit;
  count: number;
};

export type ApplyEditsResult = {
  newSpec: string;
  applied: Edit[];
  rejected: RejectedEdit[];
  /** Sum of (find.length + replace.length) across applied edits. */
  charsChanged: number;
};

export function applyEdits(spec: string, edits: Edit[]): ApplyEditsResult {
  let working = spec;
  const applied: Edit[] = [];
  const rejected: RejectedEdit[] = [];
  let charsChanged = 0;

  for (const edit of edits) {
    if (edit.find === '') {
      // Append-to-end semantics — works for both empty and non-empty specs.
      working = working + edit.replace;
      applied.push(edit);
      charsChanged += edit.replace.length;
      continue;
    }
    const count = countOccurrences(working, edit.find);
    if (count === 0) {
      rejected.push({ kind: 'no_match', edit, count: 0 });
      continue;
    }
    if (count > 1) {
      rejected.push({ kind: 'ambiguous', edit, count });
      continue;
    }
    working = working.replace(edit.find, edit.replace);
    applied.push(edit);
    charsChanged += edit.find.length + edit.replace.length;
  }

  return { newSpec: working, applied, rejected, charsChanged };
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return count;
    count += 1;
    from = idx + needle.length;
  }
}
