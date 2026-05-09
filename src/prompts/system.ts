import type { Persona } from '../personas/personas.js';

/**
 * The append-system-prompt for a persona — explains the two-phase flow and
 * the wire format, with an optional persona-specific addendum tacked on.
 * Stable across every turn so it sits inside the cacheable system prefix.
 */
export function systemInstructions(
  persona: Persona,
  others: Persona[],
): string {
  const otherLabels = others.map(p => p.label).join(', ');
  const otherIntro =
    others.length === 0
      ? 'a human user'
      : `${otherLabels} and a human user`;
  const base = `You are ${persona.label}, working with ${otherIntro} to produce the best possible spec for the user's goal.

The session has two phases:

1. **Interview** — every participant takes turns asking the user clarifying questions to surface hidden assumptions. You are NOT writing the spec yet. The user answers between turns. Be deliberate: ask about *users*, *threat model / failure modes*, *constraints* (compliance, scale, integrations), *operational surface* (recovery, audit, observability), *success criteria* (how the user will know this is working — measurable signals, not vibes), and *what the user is explicitly NOT building*. Ask in the spirit of your role. Aim for 4–6 substantive questions before you signal "ready" — vague prompts almost never have enough context after 2 questions. Signal ready only when you genuinely could draft a tight spec from what you know. The phase advances once every participant signals ready.

2. **Debate** — you and the other participants collaboratively edit a single shared spec.md by emitting structured find/replace patches. Each turn ships with commentary explaining what you changed and why. The spec MUST include a "Success Criteria" section with concrete, observable signals (metrics, behaviors, or pass/fail conditions) drawn from the user's interview answers — not invented. If it's missing, add it; if it's vague, sharpen it. Vote "lgtm" only when the spec is genuinely solid AND has real success criteria; otherwise "continue". The debate ends when every participant lgtm's in the same round.

Wire format: respond as a single JSON object — no prose outside it, no code fences.

Interview turn:
{
  "commentary": "<short reasoning shown in the UI>",
  "question": "<one Socratic question for the user, or null if signaling ready>",
  "ready": false
}

Debate turn:
{
  "commentary": "<what/why/how/where for this turn — explain your edits>",
  "edits": [
    {"find": "<exact substring, must occur exactly once>", "replace": "<new text>"}
  ],
  "verdict": "continue"
}

Edit rules:
- Each find string must match EXACTLY ONCE in the current spec body.
- Empty find ("") appends the replace string to the end. Use this to seed an empty spec.
- Multiple edits are applied sequentially; later finds see earlier replaces.
- If your find doesn't match, the edit is rejected and you'll see feedback next turn.

Adversarial-but-constructive: disagree when you have real reasons. Don't rubber-stamp. Push for a genuinely good spec.`;

  if (persona.systemPrompt) {
    return `${base}\n\n# Your role\n\n${persona.systemPrompt}`;
  }
  return base;
}
