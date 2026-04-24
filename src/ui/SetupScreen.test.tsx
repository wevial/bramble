import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { SetupScreen, type SetupSubmit } from './SetupScreen.js';
import type { ModelConfig } from './models.js';

const TAB = '\t';
const SHIFT_TAB = '\x1B[Z';
const ENTER = '\r';
const LEFT = '\x1B[D';
const RIGHT = '\x1B[C';

const EMPTY: ModelConfig = {
  claudeModel: null,
  claudeEffort: null,
  codexModel: null,
  codexEffort: null,
};

function tick(n = 1) {
  return new Promise(r => setTimeout(r, 20 * n));
}

function mount(
  overrides: Partial<React.ComponentProps<typeof SetupScreen>> = {},
) {
  const submissions: SetupSubmit[] = [];
  const quits: number[] = [];
  const el = render(
    <SetupScreen
      sessionName="test"
      initialModels={EMPTY}
      onSubmit={s => submissions.push(s)}
      onQuit={() => quits.push(1)}
      {...overrides}
    />,
  );
  return { ...el, submissions, quits };
}

describe('SetupScreen', () => {
  it('opens with the prompt field focused', () => {
    const { lastFrame, unmount } = mount();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('▸ What do you want to design?');
    expect(frame).not.toContain('▸ Mode');
    expect(frame).not.toContain('▸ Models');
    unmount();
  });

  it('types into the prompt field while focused', async () => {
    const { stdin, lastFrame, unmount } = mount();
    await tick();
    stdin.write('hello world');
    await tick();
    expect(lastFrame()).toContain('hello world');
    unmount();
  });

  it('tab advances focus through the fields', async () => {
    const { stdin, lastFrame, unmount } = mount();
    await tick();
    stdin.write(TAB);
    await tick();
    expect(lastFrame()).toContain('▸ Mode');
    stdin.write(TAB);
    await tick();
    expect(lastFrame()).toContain('▸ Models');
    stdin.write(TAB);
    await tick();
    expect(lastFrame()).toMatch(/Start/);
    // Already on Start — tab shouldn't wrap.
    stdin.write(TAB);
    await tick();
    expect(lastFrame()).toMatch(/Start/);
    unmount();
  });

  it('shift-tab retreats focus back to prompt', async () => {
    const { stdin, lastFrame, unmount } = mount();
    await tick();
    stdin.write(TAB);
    stdin.write(TAB);
    await tick();
    expect(lastFrame()).toContain('▸ Models');
    stdin.write(SHIFT_TAB);
    await tick();
    expect(lastFrame()).toContain('▸ Mode');
    stdin.write(SHIFT_TAB);
    await tick();
    expect(lastFrame()).toContain('▸ What do you want to design?');
    unmount();
  });

  it('toggles mode with left/right when the mode field is focused', async () => {
    const { stdin, lastFrame, unmount } = mount();
    await tick();
    // Default mode is auto.
    expect(lastFrame()).toContain('[● auto]');
    stdin.write(TAB); // focus mode
    await tick();
    stdin.write(RIGHT);
    await tick();
    expect(lastFrame()).toContain('[● collab]');
    stdin.write(LEFT);
    await tick();
    expect(lastFrame()).toContain('[● auto]');
    unmount();
  });

  it('submits the captured prompt, mode, and models on Enter at Start', async () => {
    const { stdin, submissions, unmount } = mount();
    await tick();
    stdin.write('design a URL shortener');
    await tick();
    stdin.write(TAB); // → mode
    await tick();
    stdin.write(RIGHT); // auto → collab
    await tick();
    stdin.write(TAB); // → models
    await tick();
    stdin.write(TAB); // → start
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toEqual({
      prompt: 'design a URL shortener',
      mode: 'collab',
      models: EMPTY,
    });
    unmount();
  });

  it('blocks Start when the prompt is empty and refocuses the prompt field', async () => {
    const { stdin, lastFrame, submissions, unmount } = mount();
    await tick();
    stdin.write(TAB); // mode
    stdin.write(TAB); // models
    stdin.write(TAB); // start
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(submissions).toHaveLength(0);
    expect(lastFrame()).toContain('▸ What do you want to design?');
    unmount();
  });

  it('preserves the prompt when retreating after tabbing forward', async () => {
    const { stdin, lastFrame, unmount } = mount();
    await tick();
    stdin.write('partial draft');
    await tick();
    stdin.write(TAB); // mode
    stdin.write(SHIFT_TAB); // back to prompt
    await tick();
    expect(lastFrame()).toContain('partial draft');
    unmount();
  });

  it('preseeds the prompt, mode, and models from props', () => {
    const { lastFrame, unmount } = mount({
      initialPrompt: 'remembered',
      initialMode: 'collab',
      initialModels: {
        claudeModel: 'claude-sonnet-4-6',
        claudeEffort: 'high',
        codexModel: 'gpt-5.4',
        codexEffort: 'high',
      },
    });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('remembered');
    expect(frame).toContain('[● collab]');
    expect(frame).toContain('sonnet 4.6 · high');
    expect(frame).toContain('gpt-5.4 · high');
    unmount();
  });
});
