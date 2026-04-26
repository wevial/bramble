import type { AgentName } from '../agents/agent.js';

export type EndReason =
  | 'mutual_lgtm'
  | 'edit_decay'
  | 'max_rounds'
  | 'user_done';

export type TerminationInput = {
  /** Most recently completed round (1-indexed). */
  round: number;
  /** Hard cap on rounds. */
  maxRounds: number;
  /** LGTM votes received in the most recently completed round. */
  lgtmThisRound: AgentName[];
  /** Per-round chars-changed totals, oldest first. */
  roundVolumes: number[];
  /** Volume strictly less than this counts as "low" for decay. */
  decayThreshold: number;
  /** Number of consecutive low-volume rounds required to trigger decay. */
  decayWindow: number;
};

/**
 * Pure check applied at the end of each completed debate round. Returns the
 * reason to terminate, or null. Priority order is fixed so that ties resolve
 * deterministically: mutual_lgtm > edit_decay > max_rounds.
 */
export function checkTermination(input: TerminationInput): EndReason | null {
  if (
    input.lgtmThisRound.includes('claude') &&
    input.lgtmThisRound.includes('codex')
  ) {
    return 'mutual_lgtm';
  }
  if (
    input.roundVolumes.length >= input.decayWindow &&
    input.decayWindow > 0 &&
    input.roundVolumes
      .slice(-input.decayWindow)
      .every(v => v < input.decayThreshold)
  ) {
    return 'edit_decay';
  }
  if (input.round >= input.maxRounds) {
    return 'max_rounds';
  }
  return null;
}
