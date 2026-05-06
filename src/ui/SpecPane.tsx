import React from 'react';
import { Box, Text } from 'ink';
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
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box justifyContent="space-between">
        <Text bold color="green">
          SPEC <Text dimColor>({title})</Text>
        </Text>
        {saveStatus === 'saving' ? (
          <Text color="yellow">Auto-saving…</Text>
        ) : saveStatus === 'saved' ? (
          <Text color="green" dimColor>Saved</Text>
        ) : null}
      </Box>
      <Box height={1} />
      <Box flexGrow={1} flexDirection="column">
        {text.length === 0 ? (
          <Text dimColor>(empty — no edits yet)</Text>
        ) : (
          <MarkdownBlock text={text} maxLines={maxLines} />
        )}
      </Box>
      <Box marginTop={1} justifyContent="space-between">
        <Text>
          <Text dimColor>{lineRangeLabel(stats.lines, maxLines)}</Text>
          <Text dimColor>{'  ·  Words: '}</Text>
          <Text>{stats.words}</Text>
          <Text dimColor>{'  ·  Chars: '}</Text>
          <Text>{stats.chars}</Text>
        </Text>
        {mode ? (
          <Text bold color={mode.color}>{mode.label}</Text>
        ) : null}
      </Box>
    </Box>
  );
}
