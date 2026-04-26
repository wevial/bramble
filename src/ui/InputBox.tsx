import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';

export type InputBoxProps = {
  onSubmit(line: string): void;
  onQuit(): void;
  disabled?: boolean;
  /** When true, hitting enter on an empty buffer still fires onSubmit(''). */
  allowEmptySubmit?: boolean;
  /** Seeds the input buffer. User can edit with backspace before submitting. */
  initialValue?: string;
  /**
   * When true, Shift+Enter / Alt+Enter / Ctrl+J insert a literal newline into
   * the buffer. Plain Enter still submits. Default false preserves the
   * single-line behaviour used in the debate's input bar.
   */
  multiline?: boolean;
  /**
   * When false, the input ignores all keystrokes. Useful when a parent
   * component owns focus management and wants this field to stay idle.
   */
  isActive?: boolean;
  /**
   * Fires on every buffer change so a parent form can keep its own copy of
   * the current value without waiting for submit.
   */
  onChange?(value: string): void;
};

export function InputBox({
  onSubmit,
  onQuit,
  disabled,
  allowEmptySubmit,
  initialValue,
  multiline,
  isActive,
  onChange,
}: InputBoxProps) {
  const [buffer, setBuffer] = useState(initialValue ?? '');
  // Notify the parent of buffer changes via effect so the callback never fires
  // mid-render — calling a parent setState inside a child updater triggers
  // React's "Cannot update a component while rendering a different one" warning.
  const lastReportedRef = useRef(buffer);
  useEffect(() => {
    if (lastReportedRef.current === buffer) return;
    lastReportedRef.current = buffer;
    onChange?.(buffer);
  }, [buffer, onChange]);

  useInput(
    (input, key) => {
      if (disabled) return;
      if (key.ctrl && input === 'c') {
        onQuit();
        return;
      }
      if (key.ctrl && input === 'd') {
        onQuit();
        return;
      }
      // Some terminals (kitty, modern xterm with modifyOtherKeys) emit a
      // CSI 27;<mod>;<code>~ sequence for modifier+key combos that the legacy
      // VT input doesn't represent — Ink leaves these as raw input. The one
      // we care about is Shift+Enter (mod 2, code 13) so the multiline prompt
      // gets a newline instead of a literal "[27;2;13~" smeared into the buffer.
      const modifyOther = input.match(/^\x1b?\[27;(\d+);(\d+)~$/);
      if (modifyOther) {
        const mod = Number(modifyOther[1]);
        const code = Number(modifyOther[2]);
        if (code === 13) {
          // Enter pressed with a modifier (Shift=2, Alt=3, Ctrl=5, ...). In
          // multiline mode, any modifier means "newline"; in single-line mode
          // we treat it as a plain submit so users aren't surprised.
          if (multiline && mod !== 1) {
            setBuffer(b => b + '\n');
            return;
          }
          const value = multiline ? buffer : buffer.trim();
          if (!multiline) setBuffer('');
          if (value.length > 0 || allowEmptySubmit) onSubmit(value);
          return;
        }
        // Unrecognized modifyOtherKeys sequence — drop it instead of typing it.
        return;
      }
      // Tab is reserved for parent-level focus navigation.
      if (key.tab) return;
      if (key.return) {
        const wantsNewline =
          multiline && (key.shift || key.meta);
        if (wantsNewline) {
          setBuffer(b => b + '\n');
          return;
        }
        // For multiline we preserve the buffer as-is (trailing whitespace is
        // rarely meaningful for single-line input, so we still trim there).
        const value = multiline ? buffer : buffer.trim();
        if (!multiline) setBuffer('');
        if (value.length > 0 || allowEmptySubmit) onSubmit(value);
        return;
      }
      // Ctrl+J is the terminal literal for LF; treat it as a newline when
      // multiline, since some terminals collapse Shift+Enter to plain Enter.
      if (multiline && key.ctrl && input === 'j') {
        setBuffer(b => b + '\n');
        return;
      }
      if (key.backspace || key.delete) {
        setBuffer(b => b.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setBuffer(b => b + input);
      }
    },
    { isActive: isActive ?? true },
  );

  if (multiline) {
    const lines = buffer.length === 0 ? [''] : buffer.split('\n');
    return (
      <Box flexDirection="column">
        {lines.map((line, i) => {
          const isLast = i === lines.length - 1;
          return (
            <Box key={i}>
              {i === 0 ? <Text color="green">{'> '}</Text> : <Text>{'  '}</Text>}
              <Text>{line}</Text>
              {isLast && (isActive ?? true) ? <Text inverse> </Text> : null}
            </Box>
          );
        })}
      </Box>
    );
  }

  return (
    <Box>
      <Text color="green">{'> '}</Text>
      <Text>{buffer}</Text>
      {(isActive ?? true) ? <Text inverse> </Text> : null}
    </Box>
  );
}
