import { writeFile } from 'node:fs/promises';
import type { InterviewTurn, UserAnswer } from '../orchestrator/state.js';

/**
 * interview.md is a human-readable mirror of the interview Q&A. Rewritten
 * on every interview turn (and every user answer) so it's always current.
 */
export async function writeInterviewMd(
  path: string,
  turns: InterviewTurn[],
  answers: UserAnswer[],
): Promise<void> {
  const lines: string[] = ['# Interview', ''];
  let answerIdx = 0;
  for (const t of turns) {
    lines.push(`## ${t.speaker}`);
    if (t.commentary) lines.push('', t.commentary);
    if (t.question) lines.push('', `> ${t.question}`);
    if (t.ready) lines.push('', '_signaled ready_');
    lines.push('');
    const ans = answers[answerIdx];
    if (ans && Date.parse(ans.timestamp) >= Date.parse(t.timestamp)) {
      lines.push('## user', '', ans.content, '');
      answerIdx++;
    }
  }
  while (answerIdx < answers.length) {
    lines.push('## user', '', answers[answerIdx]!.content, '');
    answerIdx++;
  }
  await writeFile(path, lines.join('\n'), 'utf8');
}
