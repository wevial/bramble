import type { PersonaId } from '../personas/personas.js';
import { findPersona } from '../personas/personas.js';
import type { State } from '../orchestrator/state.js';

export type CriteriaPromptInput = {
  state: State;
  speaker: PersonaId;
};

/**
 * Build the success-criteria prompt for a given speaker. This phase sits
 * between the interview and the debate: the agents propose a measurable
 * success-criteria list grounded in the interview answers, and the user
 * confirms (or revises) before any spec drafting starts. The hard goal is
 * to lock the scope of the spec so debate stays bounded.
 */
export function criteriaPrompt(input: CriteriaPromptInput): string {
  const { state, speaker } = input;
  const parts: string[] = [];

  parts.push(`# Goal\n\n${state.prompt}`);

  if (state.interview.length > 0 || state.userAnswers.length > 0) {
    const lines: string[] = [];
    let answerIdx = 0;
    for (const turn of state.interview) {
      const turnLabel = personaLabel(turn.speaker);
      const tag = turn.speaker === speaker ? `${turnLabel} (you)` : turnLabel;
      lines.push(`## ${tag}`);
      if (turn.commentary) lines.push(turn.commentary);
      if (turn.question) lines.push(`> ${turn.question}`);
      const ans = state.userAnswers[answerIdx];
      if (
        ans &&
        Date.parse(ans.timestamp) >= Date.parse(turn.timestamp)
      ) {
        lines.push(`## user\n${ans.content}`);
        answerIdx++;
      }
    }
    while (answerIdx < state.userAnswers.length) {
      lines.push(`## user\n${state.userAnswers[answerIdx]!.content}`);
      answerIdx++;
    }
    parts.push(`# Interview\n\n${lines.join('\n\n')}`);
  }

  if (state.criteriaTurns.length > 0) {
    const lines: string[] = [];
    for (const t of state.criteriaTurns) {
      const tag = t.speaker === speaker
        ? `${personaLabel(t.speaker)} (you)`
        : personaLabel(t.speaker);
      lines.push(`## ${tag}`);
      if (t.commentary) lines.push(t.commentary);
      if (t.proposed.length > 0) {
        lines.push(t.proposed.map((c, i) => `${i + 1}. ${c}`).join('\n'));
      }
    }
    parts.push(`# Criteria proposed so far\n\n${lines.join('\n\n')}`);
  }

  parts.push(buildCriteriaInstruction(state, speaker));
  return parts.join('\n\n');
}

function buildCriteriaInstruction(state: State, speaker: PersonaId): string {
  const priorCount = state.criteriaTurns.length;
  const intro =
    priorCount === 0
      ? `Propose 3-5 measurable success criteria for the spec. Each criterion must be a concrete, observable signal — a behavior, output, exit code, latency budget, or user-visible state that the user could check.`
      : `Refine the success-criteria list based on what's been proposed and any user feedback. Merge duplicates, sharpen vague items, drop scope creep.`;

  const guardrails = [
    `Anchor every criterion to something the user actually said in the interview — no inventing requirements.`,
    `Reject vibes ("fast", "intuitive", "robust") unless tied to a measurable threshold.`,
    `Stay tight — 3 sharp criteria beat 8 fuzzy ones.`,
    `Do NOT propose criteria the user hasn't endorsed; the user owns the final list and will approve via /done.`,
  ].join(' ');

  return `# Your turn\n\n${intro} ${guardrails} Respond as a single JSON object: {"commentary": "brief rationale", "proposed": ["criterion 1", "criterion 2", ...]}.`;
}

function personaLabel(id: PersonaId): string {
  return findPersona(id)?.label ?? id;
}
