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
    draftPath: join(dir, 'draft.md'),
    draftsPath: join(dir, 'drafts.md'),
    exportPath: join(dir, 'export.md'),
  };
}

async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred() && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 10));
  }
}

describe('App smoke', () => {
  it('renders both speakers, spec sidebar, and persists debate.md', async () => {
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
        rounds={1} sessionName="test-session"
        {...p}
        onDone={() => {
          done = true;
        }}
      />,
    );

    await waitFor(() => done);

    const frame = lastFrame() ?? '';
    expect(frame).toContain('claude:');
    expect(frame).toContain('codex:');
    expect(frame).toContain('CLAUDE_SAYS_HI');
    expect(frame).toContain('CODEX_REPLIES');
    expect(frame).toContain('spec-test-session.md');
    expect(frame).toContain('2 turns');

    // Free-form (non-JSON) content shows up in debate.md as the live debate,
    // but not in spec.md (which only holds draft/accepted content now).
    expect(existsSync(p.debatePath)).toBe(true);
    const debate = readFileSync(p.debatePath, 'utf8');
    expect(debate).toContain('## claude');
    expect(debate).toContain('CLAUDE_SAYS_HI');
    expect(debate).toContain('## codex');
    expect(debate).toContain('CODEX_REPLIES');

    unmount();
  });

  it('writes the accepted draft to spec.md on LGTM', async () => {
    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    claude.setResponse(
      JSON.stringify({
        commentary: 'propose',
        proposal: { body: '# Auth\n\nemail+password' },
      }),
    );
    codex.setResponse(
      JSON.stringify({ commentary: 'lgtm', verdict: 'LGTM' }),
    );

    const p = paths();
    let done = false;
    const { unmount } = render(
      <App
        agents={{ claude, codex }}
        prompt="x"
        rounds={1} sessionName="test-session"
        {...p}
        onDone={() => {
          done = true;
        }}
      />,
    );

    await waitFor(() => done);

    const spec = readFileSync(p.specPath, 'utf8');
    expect(spec).toBe('# Auth\n\nemail+password');
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
        rounds={1} sessionName="test-session"
        {...p}
        onDone={() => {
          done = true;
        }}
      />,
    );

    // let claude start streaming, then enter insert mode and interject
    await new Promise(r => setTimeout(r, 40));
    stdin.write('i');
    await new Promise(r => setTimeout(r, 10));
    for (const ch of 'wait') {
      stdin.write(ch);
      await new Promise(r => setTimeout(r, 2));
    }
    stdin.write('\r');

    await waitFor(() => done);

    const debate = readFileSync(p.debatePath, 'utf8');
    expect(debate).toContain('## user');
    expect(debate).toContain('wait');

    unmount();
  });
});
