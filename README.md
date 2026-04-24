# bramble

Three-way spec debate TUI. Claude and Codex debate (propose → critique → revise)
while you steer; the accepted draft lands in `spec.md`.

## Stack

- Node + Ink + TypeScript, package manager: bun
- Agents are spawned as subprocesses of the `claude` and `codex` CLIs —
  bramble parses their streaming output. No API keys live in bramble itself;
  each CLI handles its own auth.
- Vitest (TDD)

## Prerequisites

Both CLIs must be installed on your PATH and logged in to their respective
accounts before you run `bramble --real`:

- **`claude`** — install via [claude.ai/code](https://claude.ai/code), then
  `claude /login`. Requires an Anthropic account.
- **`codex`** — install via [openai.com/codex](https://openai.com/codex),
  then `codex login`. Requires an OpenAI account.

Bramble will fail fast with an install hint if either binary is missing when
`--real` is set.

## Quickstart

```sh
bun install
bun run dev -- "design an auth system"       # fake agents (no CLIs needed)
bun run dev -- --real "design an auth system" # real claude + codex
```

Or run without a goal and type it into the prompt-entry screen:

```sh
bun run dev -- --real
```

## Flags

```
bramble [flags] <goal...>            start a new debate
bramble --resume <name>              resume a prior session
bramble --list                       list sessions in ./.bramble

--rounds N                           max round cap (default 3)
--auto / --collab                    back-to-back turns vs. pause-between
--real                               use real claude + codex CLIs
--test                               --real with cheap/fast models pinned
--claude-model <id>                  e.g. claude-opus-4-7
--claude-effort <low|medium|high|xhigh|max>
--codex-model <id>                   e.g. gpt-5.5
--codex-effort <low|medium|high>
--isolated                           spawn agents in a tmpdir so repo
                                     CLAUDE.md / AGENTS.md don't leak in
--name <name> / --dir <path>         session name override / storage root
```

In real mode, after entering a goal you'll see a model picker (↑↓/Tab to
move rows, ←→ to cycle options, `e` on "custom…" to pin any id). Selections
override any CLI-flag defaults.

## Runtime artifacts

Sessions write to `./.bramble/<session-name>/`:

- `spec.md` — accepted spec body.
- `draft.md` — current in-flight draft (cleared on accept).
- `debate.md` — every turn rendered as markdown.
- `transcript.jsonl` — append-only structured log (source of truth for
  `--resume`).
- `export.md` — written on `/export` (goal + spec + debate transcript).

## In-app keys

- `i` / `Esc` — insert / scroll mode.
- `Tab` — swap focus between chat and spec panes.
- `j`/`k`, `gg`/`G`, `Ctrl-u`/`d` — vim-style scroll.
- `Ctrl-o` — reveal full proposals / draft side-by-side.
- `/export [name]` — write export.md (bare = session dir, named = cwd).
- `/copy` — copy accepted spec to system clipboard.
- `/quit` or `Ctrl-D` — exit.

## Tests

```sh
bun run test
```

## License

MIT — see [LICENSE](LICENSE).
