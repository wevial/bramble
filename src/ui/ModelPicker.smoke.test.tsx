import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ModelPicker } from './ModelPicker.js';
import type { ModelConfig } from './models.js';

const emptyInitial: ModelConfig = {
  claudeModel: null,
  claudeEffort: null,
  codexModel: null,
  codexEffort: null,
};

const ESC = '\x1B';
const UP = '\x1B[A';
const DOWN = '\x1B[B';
const RIGHT = '\x1B[C';
const tick = () => new Promise(r => setTimeout(r, 20));

function mount(overrides: Partial<React.ComponentProps<typeof ModelPicker>> = {}) {
  const submitted: ModelConfig[] = [];
  const cancelled: number[] = [];
  const quits: number[] = [];
  const el = render(
    <ModelPicker
      initial={emptyInitial}
      onSubmit={c => submitted.push(c)}
      onCancel={() => cancelled.push(1)}
      onQuit={() => quits.push(1)}
      {...overrides}
    />,
  );
  return { ...el, submitted, cancelled, quits };
}

describe('ModelPicker', () => {
  it('renders all four rows with default selected', () => {
    const { lastFrame, unmount } = mount();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('claude model');
    expect(frame).toContain('claude effort');
    expect(frame).toContain('codex model');
    expect(frame).toContain('codex effort');
    expect(frame).toContain('default');
    unmount();
  });

  it('submits the defaults when enter is pressed immediately', async () => {
    const { stdin, submitted, unmount } = mount();
    await tick();
    stdin.write('\r');
    await tick();
    expect(submitted).toEqual([emptyInitial]);
    unmount();
  });

  it('right-arrow cycles the focused row; submit reflects the change', async () => {
    const { stdin, submitted, unmount } = mount();
    await tick();
    stdin.write(RIGHT);
    await tick();
    stdin.write('\r');
    await tick();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.claudeModel).not.toBeNull();
    unmount();
  });

  it('down-arrow moves focus to the next row', async () => {
    const { stdin, lastFrame, unmount } = mount();
    await tick();
    stdin.write(DOWN);
    await tick();
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const effortLine = lines.find(l => l.includes('claude effort'));
    expect(effortLine).toMatch(/›/);
    unmount();
  });

  it('Esc calls onCancel', async () => {
    const { stdin, cancelled, unmount } = mount();
    await tick();
    stdin.write(ESC);
    await tick();
    expect(cancelled).toEqual([1]);
    unmount();
  });

  it('up-arrow wraps from the first row to the last', async () => {
    const { stdin, lastFrame, unmount } = mount();
    await tick();
    stdin.write(UP);
    await tick();
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const codexEffortLine = lines.find(l => l.includes('codex effort'));
    expect(codexEffortLine).toMatch(/›/);
    unmount();
  });

  it('seeds a custom model id when initial has a non-preset pin', () => {
    const { lastFrame, unmount } = mount({
      initial: { ...emptyInitial, claudeModel: 'claude-future-model-999' },
    });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('claude-future-model-999');
    unmount();
  });
});
