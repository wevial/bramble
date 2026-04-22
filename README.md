# bramble

Three-way spec debate TUI. User, Claude, and Codex collaborate to author a
spec: Claude and Codex debate (propose → critique → revise), the user chimes
in to steer, and the agreed content lands in `spec.md`.

## Stack

- Node + Ink + TypeScript
- Claude via `@anthropic-ai/sdk`
- Codex via `codex-companion.mjs` subprocess
- Vitest for tests (TDD)

## Quickstart

```sh
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY + CODEX_COMPANION_PATH
npm run dev
```

## Runtime artifacts

- `spec.md` — accepted sections of the spec.
- `debate.md` — current section's in-flight debate.
- `transcript.jsonl` — append-only log of every turn.

## In-app commands

- `/quit` or `/q` — exit cleanly (also `Ctrl-D`, or `Ctrl-C` twice).
- `/rounds N` — set per-section round cap at runtime.

## Tests

```sh
npm test
```
