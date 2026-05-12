import type { PersonaId } from '../personas/personas.js';
import { findPersona } from '../personas/personas.js';
import type { State, DebateTurn } from '../orchestrator/state.js';

export type DebatePromptInput = {
  state: State;
  speaker: PersonaId;
};

const RECENT_TURN_LIMIT = 6;

/**
 * Build the debate-phase prompt. The interview Q&A is pinned at the top so
 * it caches across every debate turn; only the spec body and recent debate
 * commentary rotate.
 */
export function debatePrompt(input: DebatePromptInput): string {
  const { state, speaker } = input;
  const parts: string[] = [];

  parts.push(`# Goal\n\n${state.prompt}`);

  if (state.interview.length > 0) {
    const qa: string[] = [];
    let answerIdx = 0;
    for (const t of state.interview) {
      if (t.question) qa.push(`Q (${personaLabel(t.speaker)}): ${t.question}`);
      const ans = state.userAnswers[answerIdx];
      if (
        ans &&
        Date.parse(ans.timestamp) >= Date.parse(t.timestamp)
      ) {
        qa.push(`A: ${ans.content}`);
        answerIdx++;
      }
    }
    if (qa.length > 0) {
      parts.push(`# Interview transcript (settled context)\n\n${qa.join('\n\n')}`);
    }
  }

  if (state.criteria && state.criteria.length > 0) {
    const lines = state.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n');
    parts.push(
      `# Success criteria (locked — the spec MUST satisfy each of these)\n\n${lines}`,
    );
  }

  parts.push(`# Current spec.md\n\n${renderSpec(state.spec)}`);

  if (state.debate.length > 0) {
    const recent = state.debate.slice(-RECENT_TURN_LIMIT);
    const lines = recent.map(t => renderDebateTurn(t, speaker));
    parts.push(`# Recent debate turns\n\n${lines.join('\n\n')}`);
  }

  // Surface rejected edits from the immediate prior turn so the agent can
  // retry intelligently. A failed find is almost always due to whitespace
  // or content drift; the agent should re-look at the current spec.
  const lastByMe = [...state.debate].reverse().find(t => t.speaker === speaker);
  if (lastByMe && lastByMe.rejected.length > 0) {
    const reasons = lastByMe.rejected
      .map(r => `- (${r.kind}, ${r.count} matches) find=${JSON.stringify(r.edit.find)}`)
      .join('\n');
    parts.push(`# Your previous edits that did NOT apply\n\n${reasons}\n\nCheck the current spec body above and adjust your find strings.`);
  }

  parts.push(buildDebateInstruction(state, speaker));
  return parts.join('\n\n');
}

function renderSpec(body: string): string {
  return body.length === 0 ? '(empty — your first edit can use find:"" to seed)' : body;
}

function renderDebateTurn(turn: DebateTurn, speaker: PersonaId): string {
  const turnLabel = personaLabel(turn.speaker);
  const tag = turn.speaker === speaker ? `${turnLabel} (you)` : turnLabel;
  const out: string[] = [`## ${tag} · round ${turn.round} · verdict ${turn.verdict}`];
  if (turn.commentary) out.push(turn.commentary);
  if (turn.applied.length > 0) {
    out.push(`(${turn.applied.length} edit${turn.applied.length === 1 ? '' : 's'} applied, ${turn.charsChanged} chars)`);
  }
  if (turn.rejected.length > 0) {
    out.push(`(${turn.rejected.length} edit${turn.rejected.length === 1 ? '' : 's'} REJECTED)`);
  }
  return out.join('\n');
}

function buildDebateInstruction(state: State, speaker: PersonaId): string {
  const lgtmHint = state.lgtmThisRound.includes(speaker)
    ? "You've already lgtm'd this round."
    : `If the spec is genuinely solid, vote "lgtm" — every participant must lgtm in the same round to end the debate.`;
  return `# Your turn\n\n${lgtmHint} Otherwise edit the spec where it needs work and vote "continue". Respond as a single JSON object: {"commentary": "...", "edits": [{"find": "...", "replace": "..."}], "verdict": "continue" | "lgtm"}.`;
}

function personaLabel(id: PersonaId): string {
  return findPersona(id)?.label ?? id;
}
