import { appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { PersonaId } from '../personas/personas.js';
import type {
  CaucusTurn,
  CriteriaTurn,
  DebateConfig,
  DebateTurn,
  EndReason,
  InterviewTurn,
  Phase,
} from '../orchestrator/state.js';
import type { RepoContext } from '../prompts/scout.js';

/**
 * Which model/effort backed each transport for a session. Provenance only —
 * replay never reads it; it answers "what did I run this with?" after the
 * fact. `null` means the CLI's own default.
 */
export type SessionModels = {
  claudeModel: string | null;
  claudeEffort: string | null;
  codexModel: string | null;
  codexEffort: string | null;
};

/**
 * Append-only typed log of every event the orchestrator ever observed. One
 * line of JSON per event — replay rebuilds State by feeding these back into
 * the reducer in order.
 */
export type TranscriptEntry =
  | {
      type: 'session';
      prompt: string;
      config: DebateConfig;
      /**
       * Phase toggles chosen at session start. Persisted so --resume can
       * restore them BEFORE the phase they gate is reached — replay can
       * only infer a toggle from its turns once those turns exist, which
       * is too late for a session resumed mid-interview. Absent in older
       * transcripts (same as false).
       */
      criteriaStep?: boolean;
      caucusStep?: boolean;
      /** Model provenance; absent in older transcripts and fake runs. */
      models?: SessionModels;
      timestamp: string;
    }
  | { type: 'scout_complete'; context: RepoContext; timestamp: string }
  | { type: 'interview_turn'; turn: InterviewTurn }
  | { type: 'criteria_turn'; turn: CriteriaTurn }
  | { type: 'caucus_turn'; turn: CaucusTurn }
  | {
      type: 'caucus_synthesis';
      speaker: PersonaId;
      commentary: string;
      summary: string;
      timestamp: string;
    }
  | { type: 'user_answer'; content: string; timestamp: string }
  | { type: 'phase_change'; phase: Phase; timestamp: string }
  | { type: 'debate_turn'; turn: DebateTurn }
  | { type: 'user_edit'; newSpec: string; timestamp: string }
  | { type: 'user_done'; timestamp: string }
  | { type: 'config_update'; patch: Partial<DebateConfig>; timestamp: string }
  | { type: 'done'; reason: EndReason; finalSpec: string; timestamp: string };

export type TranscriptSpeaker = PersonaId | 'user' | 'system';

export async function appendEntry(
  path: string,
  entry: TranscriptEntry,
): Promise<void> {
  await appendFile(path, JSON.stringify(entry) + '\n', 'utf8');
}

export async function readTranscript(path: string): Promise<TranscriptEntry[]> {
  if (!existsSync(path)) return [];
  const raw = await readFile(path, 'utf8');
  return raw
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as TranscriptEntry);
}
