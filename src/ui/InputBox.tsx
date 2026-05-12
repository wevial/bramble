import React, { useEffect, useRef, useState } from 'react';
import { createTextAttributes, decodePasteBytes } from '@opentui/core';
import { useKeyboard, usePaste } from '@opentui/react';

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

const REVERSE = createTextAttributes({ inverse: true });

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
  const [cursor, setCursor] = useState((initialValue ?? '').length);
  // useKeyboard captures the callback once; setState reads close over the
  // cursor value at registration time, so successive keystrokes would all
  // insert at the same stale index. Mirror cursor and buffer into refs so
  // the handlers always see the latest values.
  const cursorRef = useRef(cursor);
  const bufferRef = useRef(buffer);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);
  useEffect(() => {
    bufferRef.current = buffer;
  }, [buffer]);
  // Notify the parent of buffer changes via effect so the callback never fires
  // mid-render — calling a parent setState inside a child updater triggers
  // React's "Cannot update a component while rendering a different one" warning.
  const lastReportedRef = useRef(buffer);
  useEffect(() => {
    if (lastReportedRef.current === buffer) return;
    lastReportedRef.current = buffer;
    onChange?.(buffer);
  }, [buffer, onChange]);

  // Insert text at the cursor and move the cursor forward by its length.
  // Reads the live cursor via the ref so back-to-back keystrokes don't all
  // splice at the same stale index.
  const insertAtCursor = (text: string) => {
    const c = cursorRef.current;
    setBuffer(b => b.slice(0, c) + text + b.slice(c));
    cursorRef.current = c + text.length;
    setCursor(cursorRef.current);
  };

  // Clear the buffer and reset the cursor (used on submit).
  const resetBuffer = () => {
    setBuffer('');
    cursorRef.current = 0;
    setCursor(0);
  };

  // Cursor-only updates: bypass setState's stale closure by writing the ref
  // first, then mirroring into React state so the render reflects it.
  const moveCursor = (next: number) => {
    cursorRef.current = next;
    setCursor(next);
  };

  // Word-boundary scan: walk left from `from`, skip any whitespace, then
  // skip the word characters. Returns the index where the previous word
  // starts. Treats non-alphanumeric as boundary (matches macOS option-left).
  const prevWordIndex = (text: string, from: number): number => {
    let i = from;
    while (i > 0 && /\s/.test(text[i - 1]!)) i--;
    while (i > 0 && !/\s/.test(text[i - 1]!)) i--;
    return i;
  };

  const nextWordIndex = (text: string, from: number): number => {
    let i = from;
    while (i < text.length && /\s/.test(text[i]!)) i++;
    while (i < text.length && !/\s/.test(text[i]!)) i++;
    return i;
  };

  usePaste(event => {
    if (disabled || !(isActive ?? true)) return;
    insertAtCursor(decodePasteBytes(event.bytes));
  });

  useKeyboard(
    key => {
      if (!(isActive ?? true)) return;
      if (disabled) return;
      const input = key.sequence;
      if (key.ctrl && key.name === 'c') {
        onQuit();
        return;
      }
      if (key.ctrl && key.name === 'd') {
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
            insertAtCursor('\n');
            return;
          }
          const liveBuffer = bufferRef.current;
          const value = multiline ? liveBuffer : liveBuffer.trim();
          if (!multiline) resetBuffer();
          if (value.length > 0 || allowEmptySubmit) onSubmit(value);
          return;
        }
        // Unrecognized modifyOtherKeys sequence — drop it instead of typing it.
        return;
      }
      // Tab is reserved for parent-level focus navigation.
      if (key.name === 'tab') return;
      if (key.name === 'return' || key.name === 'enter') {
        const wantsNewline =
          multiline && (key.shift || key.meta);
        if (wantsNewline) {
          insertAtCursor('\n');
          return;
        }
        const liveBuffer = bufferRef.current;
        const value = multiline ? liveBuffer : liveBuffer.trim();
        if (!multiline) resetBuffer();
        if (value.length > 0 || allowEmptySubmit) onSubmit(value);
        return;
      }
      // Ctrl+J is the terminal literal for LF; treat it as a newline when
      // multiline, since some terminals collapse Shift+Enter to plain Enter.
      if (multiline && key.ctrl && key.name === 'j') {
        insertAtCursor('\n');
        return;
      }
      // Cursor navigation. Option/Alt+arrow jumps a word; plain arrow moves
      // by one character. Home/End / Ctrl+A / Ctrl+E jump to line edges.
      const liveBuffer = bufferRef.current;
      const liveCursor = cursorRef.current;
      if (key.name === 'left') {
        if (key.meta || key.option) {
          moveCursor(prevWordIndex(liveBuffer, liveCursor));
        } else {
          moveCursor(Math.max(0, liveCursor - 1));
        }
        return;
      }
      if (key.name === 'right') {
        if (key.meta || key.option) {
          moveCursor(nextWordIndex(liveBuffer, liveCursor));
        } else {
          moveCursor(Math.min(liveBuffer.length, liveCursor + 1));
        }
        return;
      }
      if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
        moveCursor(0);
        return;
      }
      if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
        moveCursor(liveBuffer.length);
        return;
      }
      if (key.name === 'backspace') {
        // Option+backspace deletes the previous word.
        if (key.meta || key.option) {
          const wordStart = prevWordIndex(liveBuffer, liveCursor);
          setBuffer(liveBuffer.slice(0, wordStart) + liveBuffer.slice(liveCursor));
          moveCursor(wordStart);
          return;
        }
        if (liveCursor === 0) return;
        setBuffer(
          liveBuffer.slice(0, liveCursor - 1) + liveBuffer.slice(liveCursor),
        );
        moveCursor(liveCursor - 1);
        return;
      }
      if (key.name === 'delete') {
        if (liveCursor >= liveBuffer.length) return;
        setBuffer(
          liveBuffer.slice(0, liveCursor) + liveBuffer.slice(liveCursor + 1),
        );
        return;
      }
      if (input && input.length === 1 && !key.ctrl && !key.meta) {
        insertAtCursor(input);
      }
    },
  );

  const showCursor = isActive ?? true;
  // Split the buffer at the cursor so the rendered line can show: text-before,
  // a reverse-attribute glyph at the cursor position, text-after. The glyph
  // shows the char *under* the cursor (or a space if at end-of-line).
  const before = buffer.slice(0, cursor);
  const atCursor = buffer[cursor] ?? ' ';
  const after = buffer.slice(cursor + 1);

  if (multiline) {
    // For multiline we render line-by-line and place the cursor on the line
    // whose offset contains it. line offsets are computed by accumulating
    // length+1 for the trailing newline.
    const lines = buffer.length === 0 ? [''] : buffer.split('\n');
    let offset = 0;
    return (
      <box flexDirection="column">
        {lines.map((line, i) => {
          const lineStart = offset;
          const lineEnd = offset + line.length;
          offset = lineEnd + 1; // +1 for the \n separator
          const cursorOnThisLine =
            showCursor && cursor >= lineStart && cursor <= lineEnd;
          const localCursor = cursor - lineStart;
          return (
            <box key={i} flexDirection="row">
              <text>
                {i === 0 ? <span fg="green">{'> '}</span> : <span>{'  '}</span>}
                {cursorOnThisLine ? (
                  <>
                    <span>{line.slice(0, localCursor)}</span>
                    <span attributes={REVERSE}>{line[localCursor] ?? ' '}</span>
                    <span>{line.slice(localCursor + 1)}</span>
                  </>
                ) : (
                  <span>{line}</span>
                )}
              </text>
            </box>
          );
        })}
      </box>
    );
  }

  return (
    <box flexDirection="row">
      <text>
        <span fg="green">{'> '}</span>
        {showCursor ? (
          <>
            <span>{before}</span>
            <span attributes={REVERSE}>{atCursor}</span>
            <span>{after}</span>
          </>
        ) : (
          <span>{buffer}</span>
        )}
      </text>
    </box>
  );
}
