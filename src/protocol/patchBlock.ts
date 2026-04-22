import { z } from 'zod';
import type { AgentOutput, ParseResult } from './patch.js';

export type PatchBlockSplit = {
  commentary: string;
  /** JSON text inside the <patch>...</patch> block, or null if no block. */
  patchJson: string | null;
};

const OPEN = '<patch>';
const CLOSE = '</patch>';

export function extractPatchBlock(raw: string): PatchBlockSplit {
  const openIdx = raw.indexOf(OPEN);
  if (openIdx === -1) {
    return { commentary: raw.trim(), patchJson: null };
  }
  const commentary = raw.slice(0, openIdx).trim();
  const afterOpen = raw.slice(openIdx + OPEN.length);
  const closeIdx = afterOpen.indexOf(CLOSE);
  const patchJson =
    closeIdx === -1 ? afterOpen.trim() : afterOpen.slice(0, closeIdx).trim();
  return { commentary, patchJson };
}

// A relaxed schema for the inner <patch> JSON: commentary is not required here
// because we source it from the free-form text outside the block.
const PatchInnerSchema = z.object({
  proposal: z
    .object({ body: z.string() })
    .nullish()
    .transform(p => p ?? null),
  verdict: z
    .enum(['LGTM', 'counter'])
    .nullish()
    .transform(v => v ?? null),
});

export function buildAgentOutputFromModel(raw: string): ParseResult {
  const { commentary, patchJson } = extractPatchBlock(raw);
  if (patchJson === null) {
    return {
      ok: true,
      value: { commentary, proposal: null, verdict: null },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(patchJson);
  } catch (e) {
    return { ok: false, error: `invalid patch JSON: ${(e as Error).message}` };
  }
  const res = PatchInnerSchema.safeParse(parsed);
  if (!res.success) {
    return { ok: false, error: res.error.message };
  }
  const value: AgentOutput = {
    commentary,
    proposal: res.data.proposal,
    verdict: res.data.verdict,
  };
  return { ok: true, value };
}
