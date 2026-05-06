import type { ReactNode } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { act } from 'react';

export async function renderFrame(node: ReactNode): Promise<{
  frame: string;
  unmount(): void;
}> {
  const setup = await renderSetup(node);
  return {
    frame: setup.frame(),
    unmount: setup.unmount,
  };
}

export async function renderSetup(node: ReactNode) {
  const setup = await testRender(node, {
    width: 100,
    height: 80,
    targetFps: 60,
  });
  await act(async () => {
    await setup.renderOnce();
  });
  return {
    ...setup,
    input: {
      async typeText(text: string) {
        await act(async () => {
          await setup.mockInput.typeText(text);
        });
      },
      pressTab(modifiers?: Parameters<typeof setup.mockInput.pressTab>[0]) {
        act(() => {
          setup.mockInput.pressTab(modifiers);
        });
      },
      pressEnter(modifiers?: Parameters<typeof setup.mockInput.pressEnter>[0]) {
        act(() => {
          setup.mockInput.pressEnter(modifiers);
        });
      },
      pressArrow(direction: 'up' | 'down' | 'left' | 'right') {
        act(() => {
          setup.mockInput.pressArrow(direction);
        });
      },
      pressKey(key: string) {
        act(() => {
          setup.mockInput.pressKey(key);
        });
      },
    },
    async update() {
      await act(async () => {
        await setup.renderOnce();
      });
    },
    frame() {
      return setup.captureCharFrame();
    },
    unmount: () => setup.renderer.destroy(),
  };
}
