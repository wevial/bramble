import type { PersonaId } from '../personas/personas.js';
import { findPersona } from '../personas/personas.js';
import type { State, InterviewTurn, UserAnswer } from '../orchestrator/state.js';
import { renderRepoContext } from './scout.js';
import { RECENT_TURN_LIMIT } from './constants.js';

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
    // Render interleaved Q&A in chronological order.
    let answerIdx = 0;
    for (const turn of state.interview) {
      answerIdx = renderTurnWithAnswer(lines, turn, state.userAnswers, answerIdx, speaker);
    }
    renderTrailingAnswers(lines, state.userAnswers, answerIdx);
    parts.push(`# Interview so far\n\n${lines.join('\n\n')}`);
  }

  parts.push(buildInterviewInstruction(state, speaker));
  return parts.join('\n\n');
}

/**
 * Compact delta prompt for interview turns after the first. Omits the stable
 * goal and repo context that are already in the persistent session's
 * conversation history — only sends recent Q&A and the turn instruction.
 */
export function interviewDeltaPrompt(input: InterviewPromptInput): string {
  const { state, speaker } = input;
  const parts: string[] = [];

  if (state.interview.length > 0 || state.userAnswers.length > 0) {
    const recent = state.interview.slice(-RECENT_TURN_LIMIT);
    const skipped = state.interview.length - recent.length;
    const lines: string[] = [];
    // Replay timestamp-based pairing for skipped turns to find the correct
    // starting answerIdx (not every turn consumes an answer).
    let answerIdx = pairAnswerIndex(state.interview, state.userAnswers, skipped);
    for (const turn of recent) {
      answerIdx = renderTurnWithAnswer(lines, turn, state.userAnswers, answerIdx, speaker);
    }
    renderTrailingAnswers(lines, state.userAnswers, answerIdx);
    parts.push(`# Recent interview turns\n\n${lines.join('\n\n')}`);
  }

  parts.push(buildInterviewInstruction(state, speaker));
  return parts.join('\n\n');
}

/**
 * Walk `turns[0..count)` and return the answerIdx that would result from
 * the timestamp-based pairing. Used by the delta prompt to skip over turns
 * already in the persistent session's context.
 */
function pairAnswerIndex(
  turns: InterviewTurn[],
  answers: UserAnswer[],
  count: number,
): number {
  let idx = 0;
  for (let i = 0; i < count; i++) {
    const ans = answers[idx];
    if (ans && Date.parse(ans.timestamp) >= Date.parse(turns[i]!.timestamp)) {
      idx++;
    }
  }
  return idx;
}

/**
 * Render a single interview turn and its paired user answer (if any).
 * Returns the next answerIdx.
 */
function renderTurnWithAnswer(
  lines: string[],
  turn: InterviewTurn,
  answers: UserAnswer[],
  answerIdx: number,
  speaker: PersonaId,
): number {
  const turnLabel = personaLabel(turn.speaker);
  const tag = turn.speaker === speaker ? `${turnLabel} (you)` : turnLabel;
  lines.push(`## ${tag}`);
  if (turn.commentary) lines.push(turn.commentary);
  if (turn.question) lines.push(`> ${turn.question}`);
  if (turn.ready) lines.push(`→ signaled ready`);
  const ans = answers[answerIdx];
  if (ans && Date.parse(ans.timestamp) >= Date.parse(turn.timestamp)) {
    lines.push(`## user\n${ans.content}`);
    return answerIdx + 1;
  }
  return answerIdx;
}

function renderTrailingAnswers(
  lines: string[],
  answers: UserAnswer[],
  startIdx: number,
): void {
  for (let i = startIdx; i < answers.length; i++) {
    lines.push(`## user\n${answers[i]!.content}`);
  }
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
