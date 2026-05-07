import type { PersonaId } from '../personas/personas.js';

export type ParsedPick = { next: PersonaId; reason: string };

/**
 * Pull a JSON object out of the moderator's raw output and validate it
 * against the eligible persona list. Returns null on parse failure or if
 * the picked persona isn't eligible.
 *
 * Tolerates surrounding whitespace, code fences, and leading/trailing
 * prose — small models ignore "no prose" instructions surprisingly often.
 */
export function parseModeratorPick(
  raw: string,
  eligible: PersonaId[],
): ParsedPick | null {
  if (!raw) return null;
  const candidates = extractJsonCandidates(raw);
  for (const candidate of candidates) {
    let obj: unknown;
    try {
      obj = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    const next = (obj as { next?: unknown }).next;
    const reason = (obj as { reason?: unknown }).reason ?? '';
    if (typeof next !== 'string') continue;
    if (!eligible.includes(next)) continue;
    return {
      next,
      reason: typeof reason === 'string' ? reason.trim() : '',
    };
  }
  return null;
}

function extractJsonCandidates(raw: string): string[] {
  const out: string[] = [];
  // Strip code fences first.
  const noFences = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
  // Try the whole thing.
  out.push(noFences.trim());
  // Greedy: first '{' to last '}'.
  const first = noFences.indexOf('{');
  const last = noFences.lastIndexOf('}');
  if (first >= 0 && last > first) {
    out.push(noFences.slice(first, last + 1));
  }
  return out;
}
