# Prompt Hygiene — Notes

Two nice-to-haves inspired by [nidhinjs/prompt-master](https://github.com/nidhinjs/prompt-master)'s task-patterns catalog. Both are additive, gated behind flags, and do not change the core debate loop.

## 1. Pre-debate lint (extends `src/prompts/interview.ts`)

**Where:** add a lint pass between goal capture and debate kickoff. `interview.ts` already exists for clarification — this slots in as the first question generator.

**Mechanics:**
- Hard-coded rubric, no LLM call needed for detection. Run regex/heuristic checks on the seed:
  - **Vague verbs:** seed matches `^(build|make|create|design|do)\s+(a|an|the)?\s*\w+$` with <8 tokens → vague.
  - **Multi-task:** count conjunctions (`and`, `plus`, `,` between verb phrases) → if >1 verb phrase, flag.
  - **Missing success criteria:** no occurrence of "so that", "must", "should", numeric constraint, or acceptance keyword.
  - **Implicit reference:** starts with "the", "that", "it", or refers to "as discussed" with no prior context.
- Each tripped pattern produces one targeted clarifying question, asked to the user *before* spawning Claude/Codex. Cap at 2 questions — past that you're annoying, not helping.
- Skip lint entirely if `--no-interview` flag or if seed is already long-form (>~50 tokens with structure).

**Output shape:** rewrites the seed into a normalized goal that gets passed to the debate. Log the rewrite so the user sees what was inferred and can correct.

**Cost:** zero LLM tokens for detection, 1 round-trip with user for clarification, saves 2–4 wasted debate rounds on under-specified goals.

## 2. Critic rubric (extends `src/moderator/prompt.ts`)

**Where:** the critique-phase system prompt the moderator hands to whichever agent is critiquing the other's draft.

**Mechanics:**
- Replace free-form "find issues with this draft" with a structured checklist the critic *must* address, one bullet each:
  1. **Specificity:** are verbs concrete? (build → "expose REST endpoint")
  2. **Scope:** is this one coherent task or several smuggled together?
  3. **Acceptance:** are success conditions stated and testable?
  4. **Assumptions:** what does the draft assume that the seed didn't say?
  5. **Underspecified surfaces:** what behaviors are named but not defined?
  6. **Out-of-scope creep:** did the draft add features the seed didn't ask for?
- Output format: JSON array of `{category, severity: low|med|high, quote, suggestion}`. Structured output makes the proposer's revision pass mechanical — address each high-severity item, justify dismissals.
- Persona variation still applies — let `src/personas/personas.ts` tilt which categories each critic weighs heaviest (e.g. a "skeptic" persona doubles scope/assumptions; a "pragmatist" weights acceptance/scope).

**Why structured beats free-form:** today's critique can wander into prose disagreements. A rubric forces coverage (the critic can't skip "acceptance criteria" because it forgot) and forces brevity (one quote + one suggestion per item, not paragraphs). Cheaper tokens, more diff-able revisions.

**Tradeoff to flag:** rubrics constrain creativity. If a critic spots something genuinely novel that doesn't fit the six buckets, give it a 7th "other" slot but cap to 1 item — keeps the escape hatch without inviting essay drift.

---

Both can ship behind flags (`--lint`, `--rubric`) and become default if they pull their weight.
