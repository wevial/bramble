---
description: Run a bramble spec debate — claude + codex interview the human, argue a design through structured rounds, and land a consensus spec. Use when the user wants a design/spec debated, a feature specced out, or asks for bramble. The human answers the interview, not you.
---

# Bramble spec debates

Bramble spawns real `claude` and `codex` CLI subprocesses that design a spec
together: they interview the goal's owner, lock success criteria, then debate
(propose → critique → revise) until mutual LGTM. You drive it through the
`bramble` MCP tools; the debate runs in the background.

## The one rule that matters

**You are the wire between bramble and the human — never the human.**
Whenever `bramble_status` (or any tool result) returns an `instruction`
starting with `ACTION REQUIRED — RELAY TO YOUR HUMAN`, present the question
or proposal to the user verbatim (AskUserQuestion works well), wait for
their real answer, and pass it back with `bramble_answer`. Do not answer
from context, do not summarize the question, do not skip ahead. The
interview is where the human's intent enters the spec — shortcutting it
produces a spec for a goal nobody has.

## Flow

1. `bramble_start` with the user's goal. Returns immediately; note the
   `session` name. Useful options: `specialists` (security, perf, ux,
   naming, ops), `caucus: true` (private positions + synthesis before the
   public debate — good against anchoring), `interview` (`low`/`medium`/
   `high` grilling; `none` skips it; `auto` is rejected here — you are the
   answer channel), `rounds`, model/effort overrides.
2. Poll `bramble_status` every 20–30 seconds. Three waiting states, each
   with relay instructions embedded: an **interview question** (relay,
   collect, `bramble_answer`), a **criteria proposal** (show the list, pass
   revisions via `bramble_answer`, or `bramble_done` when the user approves),
   and **signoff** after mutual LGTM (`bramble_answer` to request revisions,
   `bramble_done` to finalize).
3. When status shows `done`, call `bramble_get_spec` — returns the spec and
   the checkpoint doc (decision journey, per-voice highlights, deferred
   items). Offer both to the user; the checkpoint is the better PR/handoff
   artifact.

`bramble_list` shows all sessions in the store, including detached ones
from prior server processes (readable via `bramble_status`/`bramble_get_spec`,
not resumable).

## Requirements

The `bramble`, `claude`, and `codex` CLIs must be on PATH and logged in
(the MCP server spawns real agents; there is no API-key mode). Sessions
write artifacts under `./.bramble/<session>/` in the project directory.
If `bramble_start` errors about missing CLIs, tell the user what to install
rather than retrying.
