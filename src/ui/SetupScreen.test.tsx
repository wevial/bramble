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

  it('inserts a newline on the modifyOtherKeys Shift+Enter sequence', async () => {
    const { stdin, lastFrame, unmount } = mount();
    await tick();
    stdin.write('first line');
    await tick();
    // CSI 27 ; 2 ; 13 ~ — the xterm modifyOtherKeys form of Shift+Enter that
    // kitty/iTerm2/Ghostty etc. emit when the protocol is enabled.
    stdin.write('\x1b[27;2;13~');
    await tick();
    stdin.write('second line');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('first line');
    expect(frame).toContain('second line');
    expect(frame).not.toContain('27;2;13');
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
    // Each model row is now rendered inline with all its options visible,
    // and the seeded values appear among them.
    expect(frame).toContain('sonnet 4.6');
    expect(frame).toContain('gpt-5.4');
    expect(frame).toContain('high');
    unmount();
  });

  it('cycles model row focus with ↑/↓ and changes options with ←/→', async () => {
    const { stdin, lastFrame, submissions, unmount } = mount();
    await tick();
    stdin.write('design x');
    await tick();
    stdin.write(TAB); // → mode
    await tick();
    stdin.write(TAB); // → models
    await tick();
    // Default focus is on the first row (claude model). Right arrow advances
    // claude model: default → opus 4.7.
    stdin.write(RIGHT);
    await tick();
    expect(lastFrame()).toMatch(/›\s*claude model/);
    // Move down to claude effort and pick "low".
    stdin.write('\x1B[B'); // down
    await tick();
    stdin.write(RIGHT);
    await tick();
    expect(lastFrame()).toMatch(/›\s*claude effort/);
    // Tab to Start and submit.
    stdin.write(TAB); // → start
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.models.claudeModel).toBe('claude-opus-4-7');
    expect(submissions[0]!.models.claudeEffort).toBe('low');
    unmount();
  });

  it("opens custom-id editing with 'e' and saves on Enter", async () => {
    const { stdin, submissions, unmount } = mount();
    await tick();
    stdin.write('design x');
    await tick();
    stdin.write(TAB); // mode
    await tick();
    stdin.write(TAB); // models (claude model row)
    await tick();
    // Cycle claude model all the way to "custom…" — there are 5 options;
    // pressing left from index 0 wraps to the last option (custom).
    stdin.write(LEFT);
    await tick();
    stdin.write('e'); // enter custom edit
    await tick();
    stdin.write('claude-future-model');
    await tick();
    stdin.write(ENTER); // confirm custom id
    await tick();
    stdin.write(TAB); // → start
    await tick();
    stdin.write(ENTER); // launch
    await tick();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.models.claudeModel).toBe('claude-future-model');
    unmount();
  });
});
