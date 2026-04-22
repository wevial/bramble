import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeAgent } from '../agents/fake.js';
import { App } from './App.js';

function paths() {
  const dir = mkdtempSync(join(tmpdir(), 'bramble-app-'));
  return {
    transcriptPath: join(dir, 'transcript.jsonl'),
    specPath: join(dir, 'spec.md'),
    debatePath: join(dir, 'debate.md'),
  };
}

async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred() && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 10));
  }
}

describe('App smoke', () => {
  it('renders both speakers, spec sidebar, and persists spec.md + debate.md', async () => {
    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    claude.setResponse('CLAUDE_SAYS_HI');
    codex.setResponse('CODEX_REPLIES');

    const p = paths();
    let done = false;
    const { lastFrame, unmount } = render(
      <App
        agents={{ claude, codex }}
        prompt="test prompt"
        rounds={1}
        {...p}
        onDone={() => {
          done = true;
        }}
      />,
    );

    await waitFor(() => done);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Claude');
    expect(frame).toContain('Codex');
    expect(frame).toContain('spec.md');
    expect(frame).toContain('debate');
    expect(frame).toContain('2 turns recorded');

    expect(existsSync(p.specPath)).toBe(true);
    expect(existsSync(p.debatePath)).toBe(true);
    const spec = readFileSync(p.specPath, 'utf8');
    expect(spec).toContain('## claude');
    expect(spec).toContain('CLAUDE_SAYS_HI');
    expect(spec).toContain('## codex');
    expect(spec).toContain('CODEX_REPLIES');

    unmount();
  });

  it('typing at the input box interjects a user turn', async () => {
    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    claude.setResponse('aaaaaaaaaaaaaaaaaaaaaaaa');
    claude.setTokenDelayMs(20);
    codex.setResponse('ok');

    const p = paths();
    let done = false;
    const { stdin, unmount } = render(
      <App
        agents={{ claude, codex }}
        prompt="test prompt"
        rounds={1}
        {...p}
        onDone={() => {
          done = true;
        }}
      />,
    );

    // let claude start streaming, then interject
    await new Promise(r => setTimeout(r, 40));
    for (const ch of 'wait') {
      stdin.write(ch);
      await new Promise(r => setTimeout(r, 2));
    }
    stdin.write('\r');

    await waitFor(() => done);

    const spec = readFileSync(p.specPath, 'utf8');
    expect(spec).toContain('## user');
    expect(spec).toContain('wait');

    unmount();
  });
});
