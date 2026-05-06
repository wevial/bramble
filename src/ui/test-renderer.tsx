import type { ReactNode } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { act } from 'react';

export async function renderFrame(node: ReactNode): Promise<{
  frame: string;
  unmount(): void;
}> {
  const setup = await testRender(node, {
    width: 100,
    height: 40,
    targetFps: 60,
  });
  await act(async () => {
    await setup.renderOnce();
  });
  return {
    frame: setup.captureCharFrame(),
    unmount: () => setup.renderer.destroy(),
  };
}
