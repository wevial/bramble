export type SlashCommand =
  | { kind: 'quit' }
  | { kind: 'rounds'; value: number | null }
  | { kind: 'drafts' }
  | { kind: 'export'; filename: string | null }
  | { kind: 'copy' }
  | { kind: 'expand'; id: string }
  | { kind: 'unknown'; raw: string; hint: string };

export function parseSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();

  switch (head) {
    case 'quit':
    case 'q':
      return { kind: 'quit' };
    case 'rounds': {
      if (arg === '') return { kind: 'rounds', value: null };
      if (!/^\d+$/.test(arg)) {
        return {
          kind: 'unknown',
          raw: trimmed,
          hint: '/rounds expects a positive integer',
        };
      }
      const n = Number(arg);
      if (n < 1) {
        return {
          kind: 'unknown',
          raw: trimmed,
          hint: '/rounds expects a positive integer',
        };
      }
      return { kind: 'rounds', value: n };
    }
    case 'drafts':
      return { kind: 'drafts' };
    case 'export': {
      if (arg === '') return { kind: 'export', filename: null };
      const filename = arg.endsWith('.md') ? arg : `${arg}.md`;
      return { kind: 'export', filename };
    }
    case 'copy':
      return { kind: 'copy' };
    case 'expand': {
      if (!/^(claude|codex)-\d+$/.test(arg)) {
        return {
          kind: 'unknown',
          raw: trimmed,
          hint: '/expand expects <claude|codex>-<n>, e.g. /expand claude-1',
        };
      }
      return { kind: 'expand', id: arg };
    }
    default:
      return {
        kind: 'unknown',
        raw: trimmed,
        hint: `unknown command: ${trimmed}`,
      };
  }
}
