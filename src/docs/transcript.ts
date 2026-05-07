import { appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { PersonaId } from '../personas/personas.js';
import type {
  DebateConfig,
  DebateTurn,
  EndReason,
  InterviewTurn,
  Phase,
} from '../orchestrator/state.js';

/**
 * Append-only typed log of every event the orchestrator ever observed. One
 * line of JSON per event — replay rebuilds State by feeding these back into
 * the reducer in order.
 */
export type TranscriptEntry =
  | { type: 'session'; prompt: string; config: DebateConfig; timestamp: string }
  | { type: 'interview_turn'; turn: InterviewTurn }
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
