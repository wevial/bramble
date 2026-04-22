import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeAgent } from '../agents/fake.js';
import { App } from './App.js';

describe('App smoke', () => {
  it('streams agent output into speaker panes and records transcript', async () => {
    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    claude.setResponse('CLAUDE_SAYS_HI');
    codex.setResponse('CODEX_REPLIES');

    const dir = mkdtempSync(join(tmpdir(), 'bramble-app-'));
    const transcriptPath = join(dir, 'transcript.jsonl');

    let done = false;
    const { lastFrame, unmount } = render(
      <App
        agents={{ claude, codex }}
        prompt="test prompt"
        rounds={1}
        transcriptPath={transcriptPath}
        onDone={() => {
          done = true;
        }}
      />,
    );

    // wait for debate to finish
    const deadline = Date.now() + 2000;
    while (!done && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10));
    }

    const frame = lastFrame() ?? '';
    expect(done).toBe(true);
    expect(frame).toContain('CLAUDE_SAYS_HI');
    expect(frame).toContain('CODEX_REPLIES');
    expect(frame).toContain('transcript (2 turns)');

    unmount();
  });
});
