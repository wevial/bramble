import type { PersonaId } from '../personas/personas.js';
import { findPersona } from '../personas/personas.js';
import type { State } from '../orchestrator/state.js';
import { renderRepoContext } from './scout.js';

export type CaucusPromptInput = {
  state: State;
  speaker: PersonaId;
};

/**
 * Private-caucus proposal prompt. Each active persona drafts its opening
 * position INDEPENDENTLY — this prompt must never include other personas'
 * caucus proposals. That independence is the point: uncorrelated first
 * drafts avoid anchoring on whoever would have spoken first in public.
 */
export function caucusPrompt(input: CaucusPromptInput): string {
  const { state, speaker } = input;
  const parts: string[] = [];

  parts.push(`# Goal\n\n${state.prompt}`);

  if (state.repoContext) {
    const rendered = renderRepoContext(state.repoContext);
    if (rendered) parts.push(`# Repository context (read-only snapshot)\n\n${rendered}`);
  }

  const qa = interviewDigest(state);
  if (qa) parts.push(`# Interview transcript (settled context)\n\n${qa}`);

  if (state.criteria.length > 0) {
    const lines = state.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n');
    parts.push(`# Success criteria (locked)\n\n${lines}`);
  }

  parts.push(caucusInstruction(speaker));
  return parts.join('\n\n');
}

/**
 * Delta variant for a persistent session that already holds the goal,
 * interview, and (for primaries) the criteria exchange in its history.
 * Only the locked criteria (which may postdate the session's last sight of
 * them) and the caucus instruction are sent.
 */
export function caucusDeltaPrompt(input: CaucusPromptInput): string {
  const { state, speaker } = input;
  const parts: string[] = [];
  if (state.criteria.length > 0) {
    const lines = state.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n');
    parts.push(`# Success criteria (locked)\n\n${lines}`);
  }
  parts.push(caucusInstruction(speaker));
  return parts.join('\n\n');
}

/**
 * Synthesis prompt: sees every proposal and merges them into a unified
 * opening position for the public debate. Agreements become consensus;
 * disagreements are flagged explicitly instead of papered over.
 */
export function caucusSynthesisPrompt(input: CaucusPromptInput): string {
  const { state } = input;
  const parts: string[] = [];

  parts.push(`# Goal\n\n${state.prompt}`);

  if (state.criteria.length > 0) {
    const lines = state.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n');
    parts.push(`# Success criteria (locked)\n\n${lines}`);
  }

  parts.push(renderProposals(state, input.speaker));
  parts.push(synthesisInstruction());
  return parts.join('\n\n');
}

/**
 * Delta variant for the synthesizer's persistent session. The proposals are
 * NOT in its history (each was drafted in a different persona's private
 * context), so they always ride along; only the stable goal/interview
 * context is omitted.
 */
export function caucusSynthesisDeltaPrompt(input: CaucusPromptInput): string {
  return [renderProposals(input.state, input.speaker), synthesisInstruction()].join(
    '\n\n',
  );
}

function renderProposals(state: State, speaker: PersonaId): string {
  const lines: string[] = [];
  for (const t of state.caucusTurns ?? []) {
    if (t.synthesis) continue;
    const turnLabel = personaLabel(t.speaker);
    const tag = t.speaker === speaker ? `${turnLabel} (you)` : turnLabel;
    lines.push(`## ${tag}`);
    if (t.commentary) lines.push(t.commentary);
    lines.push(t.proposal);
  }
  return `# Independent proposals (drafted without seeing each other)\n\n${lines.join('\n\n')}`;
}

function caucusInstruction(speaker: PersonaId): string {
  const label = personaLabel(speaker);
  return [
    `# Your turn — private caucus`,
    '',
    `Draft your independent opening position for the spec, as ${label}. ` +
      `You are deliberating privately: you will NOT see the other participants' positions and they will NOT see yours — a synthesizer merges all positions afterwards, and only that synthesis enters the public debate. ` +
      `So commit to your genuine best take instead of hedging toward an imagined counterpart: name the architecture/approach you'd actually pick, the 2-3 decisions most likely to be contested, and what you'd explicitly rule out. ` +
      `Stay concrete and compact — this is a position statement, not a spec draft.`,
    '',
    `Respond as a single JSON object: {"commentary": "one-line stance summary", "proposal": "your position (markdown, ~150-400 words)"}.`,
  ].join('\n');
}

function synthesisInstruction(): string {
  return [
    `# Your turn — synthesize the caucus`,
    '',
    `Merge the independent proposals above into ONE unified starting position for the public debate. ` +
      `Where proposals agree, state the consensus as settled. ` +
      `Where they conflict, do NOT pick a winner or split the difference — flag the disagreement explicitly as an open question the debate must resolve, with each side's strongest argument in one line. ` +
      `Preserve any unique concern only one proposal raised.`,
    '',
    `Respond as a single JSON object: {"commentary": "one-line synthesis note", "summary": "unified position: consensus + flagged disagreements (markdown)"}.`,
  ].join('\n');
}

function interviewDigest(state: State): string | null {
  if (state.interview.length === 0) return null;
  const qa: string[] = [];
  let answerIdx = 0;
  for (const t of state.interview) {
    if (t.question) qa.push(`Q (${personaLabel(t.speaker)}): ${t.question}`);
    const ans = state.userAnswers[answerIdx];
    if (ans && Date.parse(ans.timestamp) >= Date.parse(t.timestamp)) {
      qa.push(`A: ${ans.content}`);
      answerIdx++;
    }
  }
  return qa.length > 0 ? qa.join('\n\n') : null;
}

function personaLabel(id: PersonaId): string {
  return findPersona(id)?.label ?? id;
}
