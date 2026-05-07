import React from 'react';
import { describe, it, expect } from 'vitest';
import { SetupScreen, type SetupSubmit } from './SetupScreen.js';
import type { ModelConfig } from './models.js';
import { renderSetup } from './test-renderer.js';

const EMPTY: ModelConfig = {
  claudeModel: null,
  claudeEffort: null,
  codexModel: null,
  codexEffort: null,
};

async function mount(
  overrides: Partial<React.ComponentProps<typeof SetupScreen>> = {},
) {
  const submissions: SetupSubmit[] = [];
  const quits: number[] = [];
  const el = await renderSetup(
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
  it('opens with the prompt field focused', async () => {
    const { frame, unmount } = await mount();
    const out = frame();
    expect(out).toContain('▸ What do you want to design?');
    expect(out).not.toContain('▸ Mode');
    expect(out).not.toContain('▸ Models');
    unmount();
  });

  it('types into the prompt field while focused', async () => {
    const { input, frame, update, unmount } = await mount();
    await input.typeText('hello world');
    await update();
    expect(frame()).toContain('hello world');
    unmount();
  });

  it('tab advances focus through the fields', async () => {
    const { input, frame, update, unmount } = await mount();
    input.pressTab();
    await update();
    expect(frame()).toContain('▸ Mode');
    input.pressTab();
    await update();
    expect(frame()).toContain('▸ Models');
    input.pressTab();
    await update();
    expect(frame()).toContain('▸ Specialists');
    input.pressTab();
    await update();
    expect(frame()).toContain('▸ Moderator');
    input.pressTab();
    await update();
    expect(frame()).toMatch(/Start/);
    // Already on Start — tab shouldn't wrap.
    input.pressTab();
    await update();
    expect(frame()).toMatch(/Start/);
    unmount();
  });

  it('shift-tab retreats focus back to prompt', async () => {
    const { input, frame, update, unmount } = await mount();
    input.pressTab();
    input.pressTab();
    await update();
    expect(frame()).toContain('▸ Models');
    input.pressTab({ shift: true });
    await update();
    expect(frame()).toContain('▸ Mode');
    input.pressTab({ shift: true });
    await update();
    expect(frame()).toContain('▸ What do you want to design?');
    unmount();
  });

  it('toggles mode with left/right when the mode field is focused', async () => {
    const { input, frame, update, unmount } = await mount();
    // Default mode is auto.
    expect(frame()).toContain('[● auto]');
    input.pressTab(); // focus mode
    await update();
    input.pressArrow('right');
    await update();
    expect(frame()).toContain('[● collab]');
    input.pressArrow('left');
    await update();
    expect(frame()).toContain('[● auto]');
    unmount();
  });

  it('submits the captured prompt, mode, and models on Enter at Start', async () => {
    const { input, submissions, update, unmount } = await mount();
    await input.typeText('design a URL shortener');
    input.pressTab(); // → mode
    input.pressArrow('right'); // auto → collab
    input.pressTab(); // → models
    input.pressTab(); // → specialists
    input.pressTab(); // → moderator
    input.pressTab(); // → start
    input.pressEnter();
    await update();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toEqual({
      prompt: 'design a URL shortener',
      mode: 'collab',
      models: EMPTY,
      specialists: [],
      moderator: false,
    });
    unmount();
  });

  it('blocks Start when the prompt is empty and refocuses the prompt field', async () => {
    const { input, frame, submissions, update, unmount } = await mount();
    input.pressTab(); // mode
    input.pressTab(); // models
    input.pressTab(); // specialists
    input.pressTab(); // moderator
    input.pressTab(); // start
    input.pressEnter();
    await update();
    expect(submissions).toHaveLength(0);
    expect(frame()).toContain('▸ What do you want to design?');
    unmount();
  });

  it('preserves the prompt when retreating after tabbing forward', async () => {
    const { input, frame, update, unmount } = await mount();
    await input.typeText('partial draft');
    input.pressTab(); // mode
    input.pressTab({ shift: true }); // back to prompt
    await update();
    expect(frame()).toContain('partial draft');
    unmount();
  });

  it('inserts a newline on the modifyOtherKeys Shift+Enter sequence', async () => {
    const { input, frame, update, unmount } = await mount();
    await input.typeText('first line');
    input.pressKey('\x1b[27;2;13~');
    await input.typeText('second line');
    await update();
    const out = frame();
    expect(out).toContain('first line');
    expect(out).toContain('second line');
    unmount();
  });

  it('preseeds the prompt, mode, and models from props', async () => {
    const { frame, unmount } = await mount({
      initialPrompt: 'remembered',
      initialMode: 'collab',
      initialModels: {
        claudeModel: 'claude-sonnet-4-6',
        claudeEffort: 'high',
        codexModel: 'gpt-5.4',
        codexEffort: 'high',
      },
    });
    const out = frame();
    expect(out).toContain('remembered');
    expect(out).toContain('[● collab]');
    // Each model row is now rendered inline with all its options visible,
    // and the seeded values appear among them.
    expect(out).toContain('sonnet 4.6');
    expect(out).toContain('gpt-5.4');
    expect(out).toContain('high');
    unmount();
  });

  it('cycles model row focus with ↑/↓ and changes options with ←/→', async () => {
    const { input, frame, submissions, update, unmount } = await mount();
    await input.typeText('design x');
    input.pressTab(); // → mode
    input.pressTab(); // → models
    await update();
    // Default focus is on the first row (claude model). Right arrow advances
    // claude model: default → opus 4.7.
    input.pressArrow('right');
    await update();
    expect(frame()).toMatch(/›\s*claude model/);
    // Move down to claude effort and pick "low".
    input.pressArrow('down');
    await update();
    input.pressArrow('right');
    await update();
    expect(frame()).toMatch(/›\s*claude effort/);
    // Tab to Start and submit.
    input.pressTab(); // → specialists
    input.pressTab(); // → moderator
    input.pressTab(); // → start
    input.pressEnter();
    await update();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.models.claudeModel).toBe('claude-opus-4-7');
    expect(submissions[0]!.models.claudeEffort).toBe('low');
    unmount();
  });

  it("opens custom-id editing with 'e' and saves on Enter", async () => {
    const { input, submissions, update, unmount } = await mount();
    await input.typeText('design x');
    input.pressTab(); // mode
    input.pressTab(); // models (claude model row)
    await update();
    // Cycle claude model all the way to "custom…" — there are 5 options;
    // pressing left from index 0 wraps to the last option (custom).
    input.pressArrow('left');
    input.pressKey('e'); // enter custom edit
    await update();
    await input.typeText('claude-future-model');
    input.pressEnter(); // confirm custom id
    input.pressTab(); // → specialists
    input.pressTab(); // → moderator
    input.pressTab(); // → start
    input.pressEnter(); // launch
    await update();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.models.claudeModel).toBe('claude-future-model');
    unmount();
  });
});
