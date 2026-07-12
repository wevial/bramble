# Developing bramble

Usage docs live in [README.md](README.md). This file is for working on
bramble itself.

## Stack

- **Bun** is the runtime, not just the package manager — @opentui imports
  `.scm`/`.wasm` assets Node can't load. CI pins bun 1.3.14.
- **@opentui/react** renders the TUI; components are ordinary React.
- **TypeScript**, strict; `bun run typecheck` is `tsc --noEmit`.
- Agents are subprocesses of the `claude` and `codex` CLIs — bramble parses
  their streaming output. No API keys in bramble; each CLI handles its own
  auth.

## Dev loop

```sh
bun install
bun run dev -- --mock "design x"     # scripted fakes — no CLIs, instant turns
bun run dev -- --test "design x"     # real CLIs pinned to cheap models + low effort
bun run dev -- --test --autopilot "design x"   # headless end-to-end smoke run
```

`--mock` exercises the full TUI and orchestrator against `FakeAgent`
(src/agents/fake.ts), which emits canned JSON for every phase — interview,
caucus, debate — so UI and state-machine work never needs a live model.
`--autopilot` swaps you for a cheap simulated user and prints the spec to
stdout; it's the fastest way to verify a change survives a whole session.

## Tests and CI

```sh
bun run typecheck
bun test            # or: bun test --watch, bun test src/path/file.test.ts
```

The repo is TDD-flavored: every module has a sibling `*.test.ts(x)`. TUI
components render through `src/ui/test-renderer.tsx` (opentui's `testRender`
plus act-wrapped input helpers) and assert on captured char frames.

CI (`.github/workflows/ci.yml`) runs typecheck + `bun test` on every push to
main and every PR, on bun 1.3.14 with a frozen lockfile.

## Repo layout

| path | what lives there |
|---|---|
| `src/index.tsx` | CLI entry: flag parsing, saved-setup merge, agent/moderator construction, TUI mount, autopilot path |
| `src/orchestrator/` | the state machine: `state.ts` (reducer, phases), `runner.ts` (turn loop), `replay.ts` (transcript → state rehydration), `autopilot.ts`, `scheduler.ts` |
| `src/agents/` | transports: `claude.ts` / `claude-transport.ts`, `codex.ts` / `codex-appserver.ts` (persistent app-server, default) and exec fallback, `fake.ts`, idle-timeout plumbing |
| `src/prompts/` | per-phase prompt builders (interview, criteria, caucus, debate, scout, system) — full prompts for fresh sessions, delta prompts for persistent ones |
| `src/protocol/` | zod schemas for the JSON agents must emit each phase, with salvage fallbacks for prose-wrapped JSON |
| `src/personas/` | primary + specialist persona definitions (a specialist is a system prompt riding one of the two transports) |
| `src/moderator/` | LLM moderator (cheap codex picks the next speaker) and round-robin fallback |
| `src/ui/` | React TUI: `App.tsx` (wiring), setup screen, panes, model presets (`models.ts`), sticky setup store |
| `src/docs/` | on-disk artifacts: transcript.jsonl append/read, spec/debate/interview renderers, `checkpoint.ts` (curated end-of-session doc) |
| `src/sessions/` | session dir discovery for `--list` / `--resume` |

## Architecture notes

- **transcript.jsonl is the source of truth.** Every state change appends an
  entry; `--resume` replays entries through the reducer via
  `rehydrateState`. If you add state that must survive a resume, it has to
  land in the transcript (session-level toggles ride the `session` entry —
  see `criteriaStep`/`caucusStep`).
- **Phases**: scout → interview → criteria → caucus (opt-in) → debate →
  done. The reducer in `state.ts` owns all transitions; the runner only
  dispatches actions.
- **Delta vs full prompts.** Persistent transports (claude sessions, codex
  app-server) keep context between turns, so after a persona's first turn it
  gets a small delta prompt instead of the full re-render. Anything injected
  into debate context must handle both paths (see `renderCaucusSummary`
  usage in `src/prompts/debate.ts`).
- **Model presets are hand-curated.** Neither CLI exposes a model-list
  endpoint, so `src/ui/models.ts` is maintained by hand. Adding a preset is
  a one-file change; retired ids saved in setup.json still load through the
  custom row (regression-tested in `model-rows.test.ts`). `CHEAP_CODEX_MODEL`
  / `CHEAP_CLAUDE_MODEL` back the moderator, autopilot's simulated user, and
  `--test` defaults.
- **Adding a specialist persona** is one entry in
  `src/personas/personas.ts` (id, label, glyph, color, transport, system
  prompt) — the setup screen, `--specialist` validation, and orchestrator
  pick it up from `SPECIALIST_PERSONAS`.

## Releasing / running from source

`bun link` puts a `bramble` shim on your PATH (bun's bin dir must be on
PATH). The shebang in `src/index.tsx` runs it straight from source — there
is no build step.
