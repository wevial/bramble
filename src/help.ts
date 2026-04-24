export function helpText(): string {
  return `bramble — two agents debate to produce a spec

Usage:
  bramble [flags] <goal...>            start a new debate
  bramble --resume <name> [flags]      resume a prior session
  bramble --list [--dir <path>]        list sessions in ./.bramble

Debate:
  --rounds <n>                          max round cap (default 3)
  --auto                                agents run back-to-back (default)
  --collab                              pause between turns for user review

Agents:
  --real                                use real claude + codex CLIs (default: fakes)
  --test                                --real pinned to cheap/fast models
  --claude-model <id>                   e.g. claude-sonnet-4-6
  --claude-effort <low|med|high|xhigh|max>
                                        claude reasoning effort
  --codex-model <id>                    e.g. gpt-5.4-mini
  --codex-effort <low|medium|high>      codex reasoning effort
  --isolated                            spawn agent CLIs in a tmpdir so repo
                                        CLAUDE.md / AGENTS.md don't leak in

Session:
  --name <name>                         override the generated session name
  --resume <name>                       resume an existing session
  --dir <path>                          storage root (default ./.bramble)

Other:
  -h, --help                            show this help

TUI keys:
  i / Esc                               insert / scroll mode
  Tab                                   swap chat ↔ spec focus
  j/k, gg/G, Ctrl-u/d                   vim-style scroll
  Ctrl-o                                show full proposals / draft
  /export [name] · /copy                write export.md · copy spec to clipboard
`;
}
