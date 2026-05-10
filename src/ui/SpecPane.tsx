import { createTextAttributes, RGBA, SyntaxStyle } from '@opentui/core';
import { MarkdownBlock } from './markdown.js';

export type SpecStats = { lines: number; words: number; chars: number };

export function specStats(text: string): SpecStats {
  const chars = text.length;
  if (chars === 0) return { lines: 0, words: 0, chars: 0 };
  const lines = text.split('\n').length;
  const words = text
    .split(/\s+/)
    .filter(s => s.length > 0).length;
  return { lines, words, chars };
}

export type SpecMode =
  | { label: string; color: string }
  | null;

export type SaveStatus = 'idle' | 'saving' | 'saved';

const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });

const codeStyle = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromHex('#D7DAE0') },
  keyword: { fg: RGBA.fromHex('#7AA2FF'), bold: true },
  string: { fg: RGBA.fromHex('#8CCF7E') },
  number: { fg: RGBA.fromHex('#F0C674') },
  comment: { fg: RGBA.fromHex('#7D8490'), italic: true },
  function: { fg: RGBA.fromHex('#6CCBCE') },
  variable: { fg: RGBA.fromHex('#D7DAE0') },
  property: { fg: RGBA.fromHex('#BFA3FF') },
});

export function lineRangeLabel(total: number, max?: number): string {
  if (total === 0) return 'Lines: 0';
  const visible = typeof max === 'number' ? Math.min(max, total) : total;
  if (visible >= total) return `Lines: 1-${total}`;
  return `Lines: 1-${visible} of ${total}`;
}

export function SpecPane({
  text,
  title = 'spec.md',
  maxLines,
  saveStatus = 'idle',
  mode,
}: {
  text: string;
  title?: string;
  maxLines?: number;
  saveStatus?: SaveStatus;
  mode?: SpecMode;
}) {
  const stats = specStats(text);
  return (
    <box flexDirection="column" paddingX={1} flexGrow={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text>
          <span fg="green" attributes={BOLD}>SPEC </span>
          <span attributes={DIM}>({title})</span>
        </text>
        {saveStatus === 'saving' ? (
          <text><span fg="yellow">Auto-saving…</span></text>
        ) : saveStatus === 'saved' ? (
          <text><span fg="green" attributes={DIM}>Saved</span></text>
        ) : null}
      </box>
      <box height={1} />
      <scrollbox flexGrow={1} scrollY>
        {text.length === 0 ? (
          <text><span attributes={DIM}>(empty — no edits yet)</span></text>
        ) : (
          <SpecMarkdown text={text} maxLines={maxLines} />
        )}
      </scrollbox>
      <box flexDirection="row" marginTop={1} justifyContent="space-between">
        <text>
          <span attributes={DIM}>{lineRangeLabel(stats.lines, maxLines)}</span>
          <span attributes={DIM}>{'  ·  Words: '}</span>
          <span>{stats.words}</span>
          <span attributes={DIM}>{'  ·  Chars: '}</span>
          <span>{stats.chars}</span>
        </text>
        {mode ? (
          <text><span fg={mode.color} attributes={BOLD}>{mode.label}</span></text>
        ) : null}
      </box>
    </box>
  );
}

function SpecMarkdown({
  text,
  maxLines,
}: {
  text: string;
  maxLines?: number;
}) {
  const lines = typeof maxLines === 'number'
    ? text.split('\n').slice(0, maxLines)
    : text.split('\n');
  const blocks: Array<
    | { kind: 'markdown'; text: string }
    | { kind: 'code'; filetype: string | undefined; content: string }
  > = [];
  let markdown: string[] = [];
  let code: string[] | null = null;
  let filetype: string | undefined;

  const flushMarkdown = () => {
    if (markdown.length === 0) return;
    blocks.push({ kind: 'markdown', text: markdown.join('\n') });
    markdown = [];
  };
  const flushCode = () => {
    if (!code) return;
    blocks.push({ kind: 'code', filetype, content: code.join('\n') || ' ' });
    code = null;
    filetype = undefined;
  };

  for (const line of lines) {
    const fence = line.match(/^```(\S*)/);
    if (fence) {
      if (code) {
        flushCode();
      } else {
        flushMarkdown();
        code = [];
        filetype = fence[1] || undefined;
      }
      continue;
    }
    if (code) code.push(line);
    else markdown.push(line);
  }
  if (code) flushCode();
  flushMarkdown();

  return (
    <box flexDirection="column">
      {blocks.map((block, i) =>
        block.kind === 'code' ? (
          <box key={i} flexDirection="column" marginBottom={1}>
            <code
              content={block.content}
              filetype={block.filetype}
              syntaxStyle={codeStyle}
              drawUnstyledText
              conceal={false}
            />
          </box>
        ) : (
          <MarkdownBlock key={i} text={block.text} />
        ),
      )}
    </box>
  );
}
