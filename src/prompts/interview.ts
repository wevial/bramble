import type { AgentName } from '../agents/agent.js';
import type { State } from '../orchestrator/state.js';

export type InterviewPromptInput = {
  state: State;
  speaker: AgentName;
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

  if (state.interview.length > 0 || state.userAnswers.length > 0) {
    const lines: string[] = [];
    // Render interleaved Q&A in chronological order. Each interview turn
    // pairs with the user answer that immediately followed it (if any).
    let answerIdx = 0;
    for (const turn of state.interview) {
      const tag = turn.speaker === speaker ? `${turn.speaker} (you)` : turn.speaker;
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

function buildInterviewInstruction(state: State, speaker: AgentName): string {
  const other: AgentName = speaker === 'claude' ? 'codex' : 'claude';
  const otherReady = state.readyAgents.includes(other);
  const youReady = state.readyAgents.includes(speaker);
  const hint =
    otherReady && !youReady
      ? `${other} has signaled ready. If you also have enough context, signal ready and the debate phase will start.`
      : `Don't ask filler questions — only ask if the answer would meaningfully change the spec.`;
  return `# Your turn\n\nAsk ONE clarifying question or signal ready. ${hint} Respond as a single JSON object: {"commentary": "...", "question": "..." | null, "ready": true | false}.`;
}
