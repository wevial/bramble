# Ideas worth lifting from botference

[botference](https://github.com/angadhn/botference) is a multi-agent planning TUI (you +
Claude Code + Codex). Three of its design ideas fit bramble cleanly. Bramble already has
public round-robin spec debate, specialist personas (Security/Perf/UX critics), and
mutual-LGTM termination — these are the gaps.

## 1. Checkpoint document (easiest, best ROI)

Botference outputs a curated *checkpoint* doc, not just a turn log. Bramble currently
writes `debate.md` (raw turn-by-turn) and `spec.md` (final artifact) — nothing that
synthesizes the decision journey.

Add a generator that fires when the debate ends and assembles:
- spec summary (key sections from the final `spec.md`)
- decision rationale (which specialist raised which concern, which were addressed)
- deferred items ("revisit X in v2", "security review before deploy")
- next steps (inferred from success criteria)

**Where:** new `src/docs/checkpoint.ts` with `generateCheckpoint(state, personas): string`,
wired into the end-of-session write queue in `src/ui/App.tsx` alongside `writeSpec` /
`writeInterviewMd` / `writeDebateLedger`. Optionally expose a `/checkpoint [name]` command
in `src/ui/commands.ts`. Mirror the rendering pattern in `src/docs/interview.ts`.

## 2. Caucus phase — private agent convergence

Botference's "caucus" lets agents deliberate privately, converge, then present a unified
recommendation. Bramble's all-public model can cause hedging and re-litigation. Add an
optional private synthesis stage before public debate.

**Where:**
- `src/orchestrator/state.ts` — add `'caucus'` to the Phase union; add `caucusTurns?: CaucusTurn[]`
- `src/orchestrator/runner.ts` — route caucus between interview/criteria and debate
- `src/prompts/caucus.ts` (new) — agents propose independently, then a synthesizer prompt
- `src/protocol/messages.ts` — add `CaucusProposal { proposal: string; reasoning: string }`

The interview → criteria flow already proves the multi-stage pattern; caucus is a natural
third stage.

## 3. Lead-writer election

Instead of pure round-robin edits, elect one persona as primary author (by expertise or
caucus consensus); others become reviewers.

**Where:**
- `src/orchestrator/state.ts` — add `leadWriter?: PersonaId`
- `src/orchestrator/runner.ts` — run a one-time election after caucus / at debate start
- `src/orchestrator/scheduler.ts` — `nextSpeaker()` prioritizes the lead early each round
- `src/prompts/debate.ts` — inject lead identity so agents know speaker-vs-reviewer role

Reuses the existing `LLMModerator` speaker-selection pattern (`src/moderator/moderator.ts`),
but as a single election instead of per-turn scheduling.

## Explicitly NOT worth it

- **Council/caucus UI toggle** — botference shows/hides agent transcripts via a UI switch.
  Bramble's TUI would need a significant redesign; just make caucus the default and keep
  debate public.
- **Multi-session orchestration** (spec debate → architecture debate) — needs a layer above
  the runner; out of scope.
- **Section-level reviewer handoff** — bramble's edit dispatch is global-to-spec; specialists
  already exist, fine-grained handoff is a separate abstraction.

## Priority

1. Checkpoint doc (~200 lines, pure rendering, clean integration)
2. Caucus phase (moderate, high value)
3. Lead-writer election (moderate, pairs with caucus)
