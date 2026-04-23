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
        push({ text: text.slice(i + 1, end), italic: true });
        i = end + 1;
        continue;
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

export function MarkdownLine({ line }: { line: string }) {
  const cls = classifyLine(line);
  if (cls.kind === 'heading') {
    return (
      <Text bold color={headingColor(cls.level)}>
        {'#'.repeat(cls.level)} {renderInline(cls.content)}
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
