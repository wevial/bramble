import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export type InputBoxProps = {
  onSubmit(line: string): void;
  onQuit(): void;
  disabled?: boolean;
  /** When true, hitting enter on an empty buffer still fires onSubmit(''). */
  allowEmptySubmit?: boolean;
};

export function InputBox({
  onSubmit,
  onQuit,
  disabled,
  allowEmptySubmit,
}: InputBoxProps) {
  const [buffer, setBuffer] = useState('');

  useInput((input, key) => {
    if (disabled) return;
    if (key.ctrl && input === 'c') {
      onQuit();
      return;
    }
    if (key.ctrl && input === 'd') {
      onQuit();
      return;
    }
    if (key.return) {
      const line = buffer.trim();
      setBuffer('');
      if (line.length > 0 || allowEmptySubmit) onSubmit(line);
      return;
    }
    if (key.backspace || key.delete) {
      setBuffer(b => b.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setBuffer(b => b + input);
    }
  });

  return (
    <Box>
      <Text color="green">{'> '}</Text>
      <Text>{buffer}</Text>
      <Text inverse> </Text>
    </Box>
  );
}
