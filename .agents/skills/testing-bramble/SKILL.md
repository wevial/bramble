---
name: testing-bramble
description: Test bramble CLI features and spec output. Use when verifying CLI flags, spec format converters, or TUI behavior.
---

# Testing Bramble

## Prerequisites

- **bun** must be installed (`curl -fsSL https://bun.sh/install | bash`, then `source ~/.bash_profile`)
- Run `bun install` in the repo root
- No API keys needed for fake-agent mode (the default)

## Running Tests

### Unit Tests
```sh
bun run test           # all tests
bun run test -- <file> # single file, e.g. src/docs/format.test.ts
```

### Typecheck
```sh
bun run typecheck
```

### Known Pre-Existing Test Failures
The 6 UI test files (`ConversationPane`, `FlowSidebar`, `SetupScreen`, `SpecPane`, `StatusStrip`, `markdown`) may fail with a `.scm` file extension error from `@opentui/core`. These are pre-existing and unrelated to feature changes.

## Testing CLI Flags

CLI flags can be tested directly:
```sh
bun src/index.tsx --help                    # verify flag appears in help
bun src/index.tsx --format pdf 2>&1         # verify invalid values error
```

## Testing Format Converters

The spec converters (`src/docs/format.ts`) can be tested via:
1. Unit tests in `src/docs/format.test.ts`
2. Integration scripts that import and call the converters with realistic spec content

A realistic test spec is the "Authentication Spec" that the fake agents produce (visible in the canned responses in `src/index.tsx`).

## Testing the TUI

The TUI uses alternate-screen mode and requires a TTY. To test interactively:
```sh
bun run dev -- "design an auth system"           # fake agents
bun run dev -- --format json "design an auth system"  # test with format flag
```

After a session completes, check output files in `.bramble/<session-name>/`:
- `spec.md` (or `spec.xml`, `spec.json`, `spec.html` depending on `--format`)
- `debate.md`, `interview.md`, `transcript.jsonl`

## Key Architecture Notes

- Internal spec representation is always Markdown (agents use find/replace patches)
- Format conversion happens at the persistence layer (`writeSpec` call in `App.tsx`)
- `sessionPaths()` in `src/sessions/list.ts` controls file extensions
- CLI flag parsing is in `src/index.tsx` (manual argv loop, not a flag library)
