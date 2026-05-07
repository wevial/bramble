import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DebateMode } from '../orchestrator/runner.js';

export type SavedSetup = {
  mode?: DebateMode;
  claudeModel?: string | null;
  claudeEffort?: string | null;
  codexModel?: string | null;
  codexEffort?: string | null;
  /** PersonaIds of specialist personas the user opted into last session. */
  specialists?: string[];
  /** Whether the LLM moderator was enabled last session. */
  moderator?: boolean;
};

/** Default location: ~/.bramble/setup.json — user-global, not per-project. */
export function defaultSetupPath(): string {
  return join(homedir(), '.bramble', 'setup.json');
}

export function loadSavedSetup(path: string): SavedSetup | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const src = obj as Record<string, unknown>;
  const out: SavedSetup = {};
  if (src.mode === 'auto' || src.mode === 'collab') out.mode = src.mode;
  for (const key of ['claudeModel', 'claudeEffort', 'codexModel', 'codexEffort'] as const) {
    if (!(key in src)) continue;
    const v = src[key];
    if (v === null || typeof v === 'string') out[key] = v;
  }
  if (Array.isArray(src.specialists)) {
    const ids = src.specialists.filter((s): s is string => typeof s === 'string');
    if (ids.length > 0) out.specialists = ids;
  }
  if (typeof src.moderator === 'boolean') out.moderator = src.moderator;
  return out;
}

export function saveSetup(path: string, setup: SavedSetup): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(setup, null, 2));
}
