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
 * Visible length of a line after markdown rendering. Markdown delimiters
 * (**, *, _, `) are stripped on render but present in the raw string, so
 * naive string-length padding produces misaligned borders.
 */
export function visibleLength(line: string): number {
  const cls = classifyLine(line);
  if (cls.kind === 'heading') {
    return inlineVisibleLength(cls.content);
  }
  if (cls.kind === 'bullet') {
    // renders as "<indent>• <content>" (• is 1 col, space is 1)
    return cls.indent.length + 2 + inlineVisibleLength(cls.content);
  }
  return inlineVisibleLength(cls.content);
}

function inlineVisibleLength(s: string): number {
  const spans = parseInline(s);
  let n = 0;
  for (const span of spans) n += span.text.length;
  return n;
}

export function MarkdownLine({ line }: { line: string }) {
  const cls = classifyLine(line);
  if (cls.kind === 'heading') {
    return (
      <Text bold color={headingColor(cls.level)}>
        {renderInline(cls.content)}
      </Text>
    );
  }
  if (cls.kind === 'bullet') {
    return (
      <Text>
        {cls.indent}
        <Text color="gray">•</Text> {renderInline(cls.content)}
      </Text>
    );
  }
  return <Text>{renderInline(cls.content)}</Text>;
}

/**
 * Render a multi-line markdown body with fenced code-block awareness. Lines
 * inside a ```fence``` are rendered with a code style (no inline parsing,
 * delimiters preserved); fence markers themselves are dimmed. Outside fences
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
          return (
            <Text key={i} color="gray" dimColor>
              {line}
            </Text>
          );
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
          return (
            <Text key={i} color="cyan">
              {s.text}
            </Text>
          );
        }
        return (
          <Text key={i} bold={s.bold} italic={s.italic}>
            {s.text}
          </Text>
        );
      })}
    </>
  );
}
