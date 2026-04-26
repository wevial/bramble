export type SlashCommand =
  | { kind: 'quit' }
  | { kind: 'done' }
  | { kind: 'rounds'; value: number | null }
  | { kind: 'threshold'; value: number }
  | { kind: 'decay'; value: number }
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
    case 'done':
      return { kind: 'done' };
    case 'rounds': {
      if (arg === '') return { kind: 'rounds', value: null };
      const n = parsePositiveInt(arg);
      return n === null
        ? unknown(trimmed, '/rounds expects a positive integer')
        : { kind: 'rounds', value: n };
    }
    case 'threshold': {
      const n = parsePositiveInt(arg);
      return n === null
        ? unknown(trimmed, '/threshold expects a positive integer')
        : { kind: 'threshold', value: n };
    }
    case 'decay': {
      const n = parsePositiveInt(arg);
      return n === null
        ? unknown(trimmed, '/decay expects a positive integer')
        : { kind: 'decay', value: n };
    }
    default:
      return unknown(trimmed, `unknown command: ${trimmed}`);
  }
}

function parsePositiveInt(s: string): number | null {
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 ? n : null;
}

function unknown(raw: string, hint: string): SlashCommand {
  return { kind: 'unknown', raw, hint };
}
