# Plan: `/relay` + adapter-reported context pressure

Two features, one shared primitive. Implement in the order listed — earlier steps derisk later ones. Each step has a concrete success criterion that a Vitest run can verify, except where noted.

## Background

- Bramble runs Claude + Codex as persistent CLI subprocesses (`src/agents/claude-transport.ts`, `src/agents/codex.ts`). Each turn calls `agent.stream(ctx, signal)`. Sessions persist across turns via transport-owned generation counters.
- Source of truth on disk: `transcript.jsonl`. `src/sessions/replay.ts` rehydrates state from it.
- Reference implementation (do **not** copy code, but mirror the design): botference `core/handoff.py`, `core/botference.py:1661 (_relay_model)`, `core/botference.py:2311 (_update_pct)`, `prompts/relay.md`, `templates/handoff.md`.

## Non-goals

- No automatic yielding on threshold. Pressure is *displayed* and *drives tier selection*; the user invokes `/relay` manually. Auto-yield is a follow-up.
- No `caucus` / private debate mode.
- No new participants — Claude and Codex only.
- No tool-calling, no scoped tool registries, no write-grants.

## Architecture

Shared primitive: each `Agent` can `reset()` (drop CLI session) and report `contextPercent()` (from the adapter's own usage data, not estimated from a window map).

A `/relay <persona>` command builds a **structured handoff document**, validates it, writes it to disk, tears down the CLI session for that persona, and restarts fresh — with the handoff threaded into the first prompt of the new session.

The handoff generation has a tier ladder driven by current context pressure:

| Pressure | Tier order |
|---|---|
| `< 70%` | self → mechanical |
| `≥ 70%` | mechanical only |

(*Cross-tier — other agent authors the handoff — is intentionally deferred. Two-tier is enough for v1.*)

---

## Step 1 — `Agent` contract: `reset()` + `contextPercent()`

**Files:** `src/agents/agent.ts`, `src/agents/fake.ts`, `src/agents/claude-transport.ts`, `src/agents/claude.ts`, `src/agents/codex.ts`.

1. Extend `Agent`:
   ```ts
   export interface Agent {
     readonly name: AgentName;
     stream(ctx, signal): AsyncGenerator<...>;
     /** Drop CLI session; next stream() starts fresh (no --resume / --continue). */
     reset?(): void;
     /** 0–100 if the adapter has live usage data, null otherwise. Last-turn snapshot. */
     contextPercent?(): number | null;
     dispose?(): void;
   }
   ```
2. `ClaudeTransport.reset()`: kill subprocess, clear stored session id, bump `sessionGeneration()`. Next `stream()` re-spawns with no `--resume`.
3. `CodexAgent.reset()`: same shape — drop persistent proc, clear session state.
4. `contextPercent()` on each transport: read from the last `TurnUsage` (we already capture `inputTokens`). For Claude, also include cache-read tokens in the input count when computing pressure. Use a small per-model context-window lookup **only as a fallback** when the CLI doesn't expose a percent directly — prefer a CLI-reported number when one exists (Claude's `stream-json` emits enough to compute; Codex emits a percent in its event stream — see `tests/fixtures/codex-context-percent.jsonl` in botference for the shape).
5. `FakeAgent.reset()` records the call (for assertions) and clears its internal turn counter. `contextPercent()` is settable for tests.

**Success:**
- `bun run test src/agents/` passes.
- New tests: `fake.test.ts` asserts `reset()` increments a counter; `claude-transport.test.ts` asserts `reset()` kills the subprocess and the next turn spawns a new one without `--resume`; analogous test for `codex.test.ts`.
- A typecheck (`bun tsc --noEmit`) is clean — both methods are optional, so existing call sites are untouched.

---

## Step 2 — Handoff document: schema, builder, validator

**New files:** `src/handoff/handoff.ts`, `src/handoff/handoff.test.ts`, `src/handoff/template.ts`, `src/handoff/relay-prompt.ts`.

Mirror the botference schema exactly — it's been thought through. Required frontmatter keys: `persona`, `transcript_path`, `created`, `context_pct`, `context_tokens`, `context_window`, `generation_tier`. Required headings, in order, each appearing exactly once:

```
## Objective
## Resolved Decisions
## Open Questions
## Positions In Play
### Converging
### Contested
## Constraints
## Current Thread
## Response Obligation
## Decision Criteria
## Next Action
```

1. `buildFrontmatter(opts): string` — formats the YAML block.
2. `validateHandoff(text): { valid: boolean; errors: string[] }` — parses frontmatter (regex, no YAML dep), checks required keys, validates enums (`generation_tier ∈ {self, mechanical}`, `persona ∈ {claude, codex}`), checks numeric fields, scans heading order/count.
3. `RELAY_PROMPT` constant: ports `prompts/relay.md` from botference verbatim (it's MIT-licensed; copy with attribution comment). This is the prompt fed to the agent when generating its own handoff.
4. `HANDOFF_TEMPLATE` constant: empty body with all required headings present, used by the mechanical tier.

**Success:**
- `bun run test src/handoff/` passes.
- Tests cover: valid doc round-trip; missing frontmatter key → error; invalid enum → error; duplicate heading → error; missing heading → error; wrong heading order → error; numeric field as non-numeric → error.

---

## Step 3 — Mechanical handoff generation

**File:** `src/handoff/mechanical.ts` + `mechanical.test.ts`.

Deterministic, no model call. Fills the template from transcript tail + state.

1. Function signature: `mechanicalHandoff(state: State, persona: PersonaId): string` (body only — caller adds frontmatter).
2. Strategy:
   - **Objective:** `state.prompt`.
   - **Resolved Decisions:** scan accepted spec sections — list `## ` headings as bullets.
   - **Open Questions:** scan recent debate turns for `verdict === 'continue'` commentary containing question marks.
   - **Positions In Play / Converging / Contested:** last N turns (N=8), grouped by speaker. Each bullet attributed: `Claude: …`, `Codex: …`.
   - **Constraints:** every `state.userAnswers` entry — preserve verbatim.
   - **Current Thread:** last 2 turns' commentary.
   - **Response Obligation:** "Continue the debate from the position above; the accepted spec is authoritative."
   - **Decision Criteria:** if `state.userAnswers` contains any line matching `/must|never|always|don't/i`, list them; else `None`.
   - **Next Action:** "Read the accepted spec; propose your next revision or LGTM."
3. Always returns a valid body (validation against the schema is the test assertion).

**Success:**
- Tests: given fixture states (use existing `state.test.ts` builders), output passes `validateHandoff`.
- Edge cases: empty debate (interview-only state) still validates; no userAnswers → Constraints/Decision Criteria = `None`.

---

## Step 4 — Self-authored handoff generation

**File:** extend `src/orchestrator/runner.ts` with a helper `generateSelfHandoff(persona, state, agent, signal)`.

1. Build a one-shot prompt: `RELAY_PROMPT` + a marker like `"\n\nThe debate transcript and accepted spec follow:\n\n" + renderTranscript(state)`.
2. Call `agent.stream({ phase: 'debate', prompt }, signal)` and collect the full output.
3. Prepend the controller-built frontmatter (the agent only writes the body, per the prompt's instructions).
4. Return `{ doc, raw }` — caller validates.

**Success:**
- New runner test injects a FakeAgent that emits a valid handoff body and asserts: agent was called once with the relay prompt; returned doc passes `validateHandoff`.
- Failure-path test: FakeAgent emits malformed output (missing headings); the doc fails validation and the caller can detect it.

---

## Step 5 — Transcript: `relay` entry type

**Files:** `src/docs/transcript.ts`, `src/sessions/replay.ts`, `src/orchestrator/state.ts`.

1. New transcript entry variant:
   ```ts
   { type: 'relay', persona: PersonaId, tier: 'self' | 'mechanical',
     contextPct: number | null, handoffPath: string, timestamp: string }
   ```
2. New state action `{ type: 'relayed', persona, tier, turnIndex }`.
3. Reducer: store `state.relayBoundary[persona] = state.debate.length` so the prompt builder knows where the fresh session begins.
4. Replay: rehydrate `relayBoundary` from a `relay` entry. **It does *not* call `Agent.reset()` during replay** — replay just reconstructs state; if the user resumes a session, the new CLI sessions start fresh anyway.
5. `golden` replay test: a transcript containing a `relay` entry round-trips through `rehydrateState` with `relayBoundary` populated.

**Success:**
- `bun run test src/sessions/` and `src/docs/transcript.test.ts` pass.
- Golden file under `tests/fixtures/` (or wherever bramble keeps them) shows the new entry shape.

---

## Step 6 — Prompt builder: post-relay framing

**File:** `src/prompts/debate.ts`.

1. When `state.relayBoundary[speaker]` is set:
   - Inject a header before the per-turn section: *"Your prior context was discarded at this boundary. The handoff document and accepted spec below are the only state. Earlier turns above the boundary are shown for the **other** agent's continuity — do not assume you remember them."*
   - Inline the most recent handoff document for that persona (loaded by the runner from `handoffPath` and passed via `TurnContext`).
2. Extend `TurnContext`:
   ```ts
   handoff?: { persona: PersonaId; doc: string };
   ```
   Runner sets this only on the *first* turn after a relay for that persona, then clears it.

**Success:**
- Snapshot test in `src/prompts/` covers: no handoff → unchanged output; with handoff → handoff doc appears, boundary header appears, pre-boundary turns are de-emphasized or omitted for the relayed speaker.
- Manual sanity: run `bun run dev -- "test"`, trigger `/relay claude`, confirm the next Claude turn's prompt (log it via existing `prompt-*.txt` mechanism — see `.gitignore`) contains the handoff body.

---

## Step 7 — Tier selection + runner orchestration

**File:** `src/orchestrator/runner.ts`, plus a new method on `RunHandle`.

1. New `RunHandle.relay(persona: PersonaId): Promise<void>`.
2. Implementation:
   ```
   pct = agent.contextPercent?.() ?? 0
   tiers = pct < 70 ? ['self', 'mechanical'] : ['mechanical']
   for tier of tiers:
     body = tier === 'self' ? await generateSelfHandoff(...) : mechanicalHandoff(...)
     doc  = buildFrontmatter({ ..., generation_tier: tier, context_pct: pct }) + body
     if validateHandoff(doc).valid: break
   if no valid doc: dispatch error notice; abort relay
   write doc to `<sessionDir>/handoffs/<persona>/<timestamp>.md`
   dispatch { type: 'relayed', persona, tier, turnIndex: state.debate.length }
   queueAppend({ type: 'relay', persona, tier, contextPct: pct,
                 handoffPath, timestamp })
   agents[persona].reset?.()
   stash pending handoff so the next turn's TurnContext carries it
   ```
3. The relay is **synchronous from the user's perspective**: if a turn is in flight for that persona, abort it (`turnController.abort()`) before resetting. If a turn is in flight for the *other* persona, let it finish — relay only affects the targeted persona.

**Success:**
- Runner test: with FakeAgent at `contextPercent: 30`, `relay('claude')` calls `reset` exactly once, writes a `relay` transcript entry, and the next `claude` turn's `TurnContext.handoff` is set; the turn after that, it's not.
- Runner test: with FakeAgent at `contextPercent: 95`, only the mechanical tier is attempted (assert the self-handoff prompt was not sent).
- Runner test: self-tier produces invalid handoff → falls through to mechanical → mechanical doc is written; transcript entry shows `tier: 'mechanical'`.

---

## Step 8 — UI: `/relay` slash command

**File:** `src/index.tsx`.

1. Parse `/relay claude` and `/relay codex` alongside existing `/export`, `/copy`, `/quit`.
2. Reject bare `/relay` with a one-line usage hint in the chat scroll: `Usage: /relay claude | /relay codex`.
3. Reject relay of a persona that hasn't taken any turns yet.
4. On success, render a one-line system entry in the chat: `Relayed claude (tier: self) — fresh session started.`
5. Status footer (where context pressure will surface in step 9) updates immediately.

**Success:**
- Manual: `bun run dev -- "design auth"`, wait through a few rounds, type `/relay claude`, observe the system line and confirm the next Claude turn's commentary doesn't reference pre-relay turns.
- The existing help tests (`src/help.test.ts`) cover that `/relay` is listed; extend with one assertion.

---

## Step 9 — Surface context pressure in the footer

**File:** `src/index.tsx` (or wherever the footer/status bar lives — `rg "Setup footer" -l` based on recent commit `7ed0f9f`).

1. After each `onUsage` callback, store `contextPercent` per persona in UI state.
2. Render in the footer: `Claude 42% · Codex 28%` next to the existing ctrl+c hint.
3. Hide when `null` (interview phase, or adapter doesn't report).
4. Highlight (color or `*` suffix) when ≥ 70% — same threshold as the tier ladder, so the user has a clear signal *before* a relay would degrade to mechanical-only.

**Success:**
- Manual: run a `--real` session for ≥ 5 rounds and observe pressure climbing in the footer.
- No new tests required — this is presentation-only over data already wired in step 1.

---

## Step 10 — Documentation

**Files:** `README.md`, `src/help.ts`.

1. Add `/relay <persona>` to the "In-app keys" section of the README.
2. Add a short paragraph under "Runtime artifacts" describing `handoffs/<persona>/<timestamp>.md`.
3. Update `src/help.ts` to include the new command.
4. Existing `src/help.test.ts` should still pass after updating its expected output snapshot.

**Success:**
- `bun run test` is fully green.
- A new contributor reading `README.md` can answer: *what does `/relay` do, when do I use it, where do the artifacts land.*

---

## Global success criteria

The feature is done when all of these hold:

1. `bun run test` is green.
2. `bun tsc --noEmit` is clean.
3. Manual `--real` run: start a debate, let it run ~5 rounds, type `/relay claude`, observe (a) a `handoffs/` artifact on disk that passes `validateHandoff`, (b) a `relay` line in `transcript.jsonl`, (c) the next Claude turn proceeds without referencing pre-relay turns and respects the constraints in the handoff.
4. `bun run dev -- --resume <session>` on a transcript containing a `relay` entry restores correctly (no crash, `relayBoundary` populated, debate continues).
5. Footer shows live context pressure for both personas during a `--real` session.
6. No regression: existing tests in `src/orchestrator/`, `src/agents/`, `src/sessions/`, `src/prompts/` all still pass without modification beyond what step 5 explicitly required.

## Out-of-scope follow-ups

Record these as TODOs but do **not** implement in this pass:
- **Auto-relay on threshold.** Once pressure exceeds 85%, trigger relay automatically before the next turn for that persona.
- **Cross-tier handoff.** Have the other agent author the handoff when the relayed agent is too cooked to author its own.
- **Handoff diffing.** Show the user what state was carried vs. dropped before confirming a relay.
