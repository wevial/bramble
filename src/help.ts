export function helpText(): string {
  return `bramble — two agents debate to produce a spec

Usage:
  bramble [flags] <goal...>            start a new debate
  bramble --resume <name> [flags]      resume a prior session
  bramble --list [--dir <path>]        list sessions in ./.bramble

Debate:
  --rounds <n>                          max round cap (default 8)
  --auto                                agents run back-to-back (default)
  --collab                              pause between turns for user review

Agents:
  --real                                use real claude + codex CLIs (default: fakes)
  --test                                --real pinned to cheap/fast models
  --claude-model <id>                   e.g. claude-sonnet-4-6
  --claude-effort <low|medium|high|xhigh|max>
                                        claude reasoning effort
  --codex-model <id>                    e.g. gpt-5.4-mini
  --codex-effort <low|medium|high>      codex reasoning effort
  --codex-transport <app-server|exec>   app-server: one persistent codex
                                        process per debate (default, fastest);
                                        exec: legacy per-turn codex exec
  --isolated                            spawn agent CLIs in a tmpdir so repo
                                        CLAUDE.md / AGENTS.md don't leak in
  --turn-timeout <seconds>              kill an agent turn if it produces no
                                        output for this long (default 300;
                                        0 disables)

Output:
  --format <md|xml|json|html>           spec output format (default: md)

Autopilot (headless — no TUI, no prompts):
  --autopilot                           run to completion with a cheap LLM
                                        answering the interview for you; prints
                                        the spec and exits. Pairs with --test.
  --autopilot-answers <n>               interview questions to answer before
                                        forcing the debate (default 3)

Session:
  --name <name>                         override the generated session name
  --resume <name>                       resume an existing session
  --dir <path>                          storage root (default ./.bramble)

Other:
  -h, --help                            show this help
  -v, --version                         show version

TUI keys:
  i / Esc                               insert / scroll mode
  Tab                                   swap chat ↔ spec focus
  j/k, gg/G, Ctrl-u/d                   vim-style scroll
  Ctrl-o                                show full proposals / draft
  /export [name] · /copy                write export.md · copy spec to clipboard
`;
}
