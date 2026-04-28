import React from 'react';
import { Text } from 'ink';

type InlineSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
};

/**
 * Parse a single already-wrapped text line into styled spans. Handles
 * inline `code`, **bold**, and *italic* / _italic_. Deliberately simple —
 * good enough for spec bodies, not a full CommonMark parser.
 */
export function parseInline(text: string): InlineSpan[] {
  const out: InlineSpan[] = [];
  let i = 0;
  const push = (span: InlineSpan) => {
    if (span.text.length === 0) return;
    const last = out[out.length - 1];
    if (
      last &&
      !!last.bold === !!span.bold &&
      !!last.italic === !!span.italic &&
      !!last.code === !!span.code
    ) {
      last.text += span.text;
    } else {
      out.push(span);
    }
  };

  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        push({ text: text.slice(i + 2, end), bold: true });
        i = end + 2;
        continue;
      }
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        push({ text: text.slice(i + 1, end), code: true });
        i = end + 1;
        continue;
      }
      i++;
      continue;
    }
    if (text[i] === '*' || text[i] === '_') {
      const delim = text[i]!;
      const end = text.indexOf(delim, i + 1);
      // avoid matching **...** as two italic opens/closes
      if (end > i + 1 && text[end + 1] !== delim && text[i + 1] !== delim) {
        // For `_`, require a word boundary on each side — otherwise
        // identifiers like CLAUDE_SAYS_HI or snake_case would render as
        // italic runs with the underscores stripped.
        const openOk =
          delim !== '_' || i === 0 || !/\w/.test(text[i - 1] ?? '');
        const closeOk =
          delim !== '_' ||
          end === text.length - 1 ||
          !/\w/.test(text[end + 1] ?? '');
        if (openOk && closeOk) {
          push({ text: text.slice(i + 1, end), italic: true });
          i = end + 1;
          continue;
        }
      }
    }
    push({ text: text[i]! });
    i++;
  }
  return out;
}

type LineClass =
  | { kind: 'heading'; level: number; content: string }
  | { kind: 'bullet'; indent: string; bullet: string; content: string }
  | { kind: 'plain'; content: string };

export function classifyLine(line: string): LineClass {
  const h = line.match(/^(#{1,6})\s+(.*)/);
  if (h) return { kind: 'heading', level: h[1]!.length, content: h[2]! };
  const b = line.match(/^(\s*)([-*])\s+(.*)/);
  if (b) return { kind: 'bullet', indent: b[1]!, bullet: b[2]!, content: b[3]! };
  return { kind: 'plain', content: line };
}

function headingColor(level: number): string | undefined {
  if (level === 1) return 'magenta';
  if (level === 2) return 'cyan';
  if (level === 3) return 'yellow';
  return undefined;
}

/**
 * Visible length of a line after markdown rendering. Inline delimiters
 * (`code`, **bold**, *italic*) are preserved on render, so a line's
 * visible length now matches its source length except for fence rows
 * (which render as a single blank row regardless).
 */
export function visibleLength(line: string): number {
  if (line.startsWith('```')) return 0;
  return line.length;
}

export function MarkdownLine({ line }: { line: string }) {
  const cls = classifyLine(line);
  if (cls.kind === 'heading') {
    // Keep the leading `#` markers visible — the user reads markdown source.
    const hashes = '#'.repeat(cls.level);
    return (
      <Text bold color={headingColor(cls.level)}>
        {hashes} {renderInline(cls.content)}
      </Text>
    );
  }
  if (cls.kind === 'bullet') {
    return (
      <Text>
        {cls.indent}
        <Text color="cyan">{cls.bullet}</Text> {renderInline(cls.content)}
      </Text>
    );
  }
  return <Text>{renderInline(cls.content)}</Text>;
}

/**
 * Render a multi-line markdown body with fenced code-block awareness. Lines
 * inside a ```fence``` are rendered with a code style (no inline parsing,
 * delimiters preserved); fence markers themselves are hidden. Outside fences
 * each line goes through MarkdownLine.
 */
export function MarkdownBlock({
  text,
  maxLines,
}: {
  text: string;
  maxLines?: number;
}) {
  const lines = text.split('\n');
  const sliced =
    typeof maxLines === 'number' ? lines.slice(0, maxLines) : lines;
  let inFence = false;
  return (
    <>
      {sliced.map((line, i) => {
        if (line.startsWith('```')) {
          inFence = !inFence;
          return <Text key={i}> </Text>;
        }
        if (inFence) {
          return (
            <Text key={i} color="cyan">
              {line || ' '}
            </Text>
          );
        }
        if (line === '') return <Text key={i}> </Text>;
        return <MarkdownLine key={i} line={line} />;
      })}
    </>
  );
}

/**
 * Inline-only markdown rendering: parses **bold**, *italic*, `code` but does
 * NOT interpret leading # or - as structural (use MarkdownLine for that).
 * Intended for chat commentary where the text may contain inline formatting
 * but should not reflow as headings/bullets.
 */
export function InlineText({ text }: { text: string }) {
  return <>{renderInline(text)}</>;
}

function renderInline(text: string): React.ReactNode {
  const spans = parseInline(text);
  return (
    <>
      {spans.map((s, i) => {
        if (s.code) {
          // Keep the backticks visible — the user wants to see markdown
          // source — but tint the content so it still reads as code.
          return (
            <Text key={i}>
              <Text dimColor>`</Text>
              <Text color="cyan">{s.text}</Text>
              <Text dimColor>`</Text>
            </Text>
          );
        }
        if (s.bold) {
          return (
            <Text key={i} bold>
              <Text dimColor>**</Text>
              {s.text}
              <Text dimColor>**</Text>
            </Text>
          );
        }
        if (s.italic) {
          return (
            <Text key={i} italic>
              <Text dimColor>*</Text>
              {s.text}
              <Text dimColor>*</Text>
            </Text>
          );
        }
        return <Text key={i}>{s.text}</Text>;
      })}
    </>
  );
}
