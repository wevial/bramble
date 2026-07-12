import React from 'react';
import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from './App.js';
import { FakeAgent } from '../agents/fake.js';
import { initialState, type State } from '../orchestrator/state.js';
import type { Moderator } from '../moderator/moderator.js';
import type { Persona } from '../personas/personas.js';
import { renderSetup } from './test-renderer.js';

/**
 * Regression: --resume skips the setup screen, so the setup-submit handler
 * that used to be the only place a Moderator was built never runs. The
 * moderator preference (flag or saved setup) must still take effect.
 */

function resumedState(): State {
  // An interview turn marks the session as a resume (setup screen skipped);
  // endReason makes the runner finish immediately so the test doesn't
  // actually debate.
  const s = initialState('resumed goal');
  return {
    ...s,
    interview: [
      {
        speaker: 'claude',
        commentary: '',
        question: 'What is the scope?',
        ready: false,
        timestamp: new Date().toISOString(),
      },
    ],
    phase: 'done',
    endReason: 'user_done',
  };
}

const STUB_MODERATOR: Moderator = {
  async pick() {
    return { next: 'claude' as const, reason: 'stub' };
  },
};

async function mountResumedApp(opts: {
  initialModerator?: boolean;
  buildCalls: Persona[][];
}) {
  const dir = mkdtempSync(join(tmpdir(), 'bramble-app-test-'));
  return renderSetup(
    <App
      agents={{ claude: new FakeAgent('claude'), codex: new FakeAgent('codex') }}
      prompt="resumed goal"
      sessionName="resume-test"
      initialState={resumedState()}
      transcriptPath={join(dir, 'transcript.jsonl')}
      specPath={join(dir, 'spec.md')}
      debatePath={join(dir, 'debate.md')}
      interviewPath={join(dir, 'interview.md')}
      initialModerator={opts.initialModerator}
      buildModerator={personas => {
        opts.buildCalls.push(personas);
        return STUB_MODERATOR;
      }}
    />,
  );
}

describe('App resume + moderator', () => {
  it('builds the moderator on mount when resuming with the preference on', async () => {
    const buildCalls: Persona[][] = [];
    const { unmount } = await mountResumedApp({
      initialModerator: true,
      buildCalls,
    });
    expect(buildCalls).toHaveLength(1);
    // Personas passed to the builder are the ones restored from state.
    expect(buildCalls[0]!.map(p => p.id)).toEqual(['claude', 'codex']);
    unmount();
  });

  it('does not build a moderator on resume when the preference is off', async () => {
    const buildCalls: Persona[][] = [];
    const { unmount } = await mountResumedApp({
      initialModerator: false,
      buildCalls,
    });
    expect(buildCalls).toHaveLength(0);
    unmount();
  });
});
