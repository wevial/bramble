import type { PersonaId } from '../personas/personas.js';
import { findPersona } from '../personas/personas.js';
import type { State } from '../orchestrator/state.js';
import { renderRepoContext } from './scout.js';

export type InterviewPromptInput = {
  state: State;
  speaker: PersonaId;
};

/**
 * Build the interview-phase prompt for a given speaker. Includes the user's
 * goal, the prior interview Q&A, and the latest user answer. The system
 * instructions (wire format, role) live in the agent's append-system-prompt
 * and are not duplicated here so the prefix can cache.
 */
export function interviewPrompt(input: InterviewPromptInput): string {
  const { state, speaker } = input;
  const parts: string[] = [];

  parts.push(`# Goal\n\n${state.prompt}`);

  if (state.repoContext) {
    const rendered = renderRepoContext(state.repoContext);
    if (rendered) parts.push(`# Repository context (read-only snapshot)\n\n${rendered}`);
  }

  if (state.interview.length > 0 || state.userAnswers.length > 0) {
    const lines: string[] = [];
    // Render interleaved Q&A in chronological order. Each interview turn
    // pairs with the user answer that immediately followed it (if any).
    let answerIdx = 0;
    for (const turn of state.interview) {
      const turnLabel = personaLabel(turn.speaker);
      const tag = turn.speaker === speaker ? `${turnLabel} (you)` : turnLabel;
      lines.push(`## ${tag}`);
      if (turn.commentary) lines.push(turn.commentary);
      if (turn.question) lines.push(`> ${turn.question}`);
      if (turn.ready) lines.push(`→ signaled ready`);
      // The user answer that landed AFTER this turn (if any).
      const ans = state.userAnswers[answerIdx];
      if (
        ans &&
        Date.parse(ans.timestamp) >= Date.parse(turn.timestamp)
      ) {
        lines.push(`## user\n${ans.content}`);
        answerIdx++;
      }
    }
    // Any user answers that came before the first interview turn.
    while (answerIdx < state.userAnswers.length) {
      lines.push(`## user\n${state.userAnswers[answerIdx]!.content}`);
      answerIdx++;
    }
    parts.push(`# Interview so far\n\n${lines.join('\n\n')}`);
  }

  parts.push(buildInterviewInstruction(state, speaker));
  return parts.join('\n\n');
}

function buildInterviewInstruction(state: State, speaker: PersonaId): string {
  const active = state.activePersonas ?? ['claude', 'codex'];
  const others = active.filter(p => p !== speaker);
  const othersReady = others.filter(p => state.readyAgents.includes(p));
  const youReady = state.readyAgents.includes(speaker);
  let hint: string;
  if (othersReady.length > 0 && !youReady) {
    const readyLabels = othersReady.map(personaLabel).join(', ');
    hint = `${readyLabels} ${othersReady.length === 1 ? 'has' : 'have'} signaled ready. If you also have enough context, signal ready — the debate phase starts when every participant is ready.`;
  } else {
    hint = `Don't ask filler questions — only ask if the answer would meaningfully change the spec.`;
  }
  return `# Your turn\n\nAsk ONE clarifying question or signal ready. ${hint} Respond as a single JSON object: {"commentary": "...", "question": "..." | null, "ready": true | false}.`;
}

function personaLabel(id: PersonaId): string {
  return findPersona(id)?.label ?? id;
}
