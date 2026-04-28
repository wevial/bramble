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

export function SpecPane({
  text,
  title = 'spec.md',
  maxLines,
}: {
  text: string;
  title?: string;
  maxLines?: number;
}) {
  const stats = specStats(text);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="green">SPEC ({title})</Text>
      <Box height={1} />
      <Box flexGrow={1} flexDirection="column">
        {text.length === 0 ? (
          <Text dimColor>(empty — no edits yet)</Text>
        ) : (
          <MarkdownBlock text={text} maxLines={maxLines} />
        )}
      </Box>
      <Box marginTop={1}>
        <Text>
          <Text dimColor>Lines: </Text>
          <Text>{stats.lines}</Text>
          <Text dimColor>{'  Words: '}</Text>
          <Text>{stats.words}</Text>
          <Text dimColor>{'  Chars: '}</Text>
          <Text>{stats.chars}</Text>
        </Text>
      </Box>
    </Box>
  );
}
