import React from 'react';
import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from './App.js';
import { FakeAgent } from '../agents/fake.js';
import type { Agent } from '../agents/agent.js';
import { readTranscript } from '../docs/transcript.js';
import { renderSetup } from './test-renderer.js';

/**
 * 'auto' interview intensity: the simulated user answers interview questions
 * in the user's place, interactively. Verifies the App-side answer loop
 * actually fires (the runner/prompt sides are covered in
 * orchestrator/interview-intensity.test.ts).
 */

function until(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (cond()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('until: timeout'));
      setTimeout(poll, 20);
    };
    poll();
  });
}

describe('App auto interview', () => {
  it('answers interview questions via the simulated user', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bramble-auto-'));
    const transcriptPath = join(dir, 'transcript.jsonl');

    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    claude.setResponses([
      { kind: 'interview', commentary: 'scoping', question: 'What is the scope?' },
      { kind: 'interview', commentary: 'enough', ready: true },
    ]);
    codex.setResponses([
      { kind: 'interview', commentary: 'checking', question: 'Any constraints?' },
      { kind: 'interview', commentary: 'enough', ready: true },
    ]);

    const answered: string[] = [];
    const simulatedUser: Agent = {
      name: 'codex',
      // eslint-disable-next-line require-yield
      async *stream(ctx) {
        answered.push(ctx.prompt);
        return { raw: 'A small internal tool; no constraints.' };
      },
    };

    const { unmount } = await renderSetup(
      <App
        agents={{ claude, codex }}
        prompt="design x"
        sessionName="auto-test"
        skipPromptEntry
        initialInterview="auto"
        simulatedUser={simulatedUser}
        transcriptPath={transcriptPath}
        specPath={join(dir, 'spec.md')}
        debatePath={join(dir, 'debate.md')}
        interviewPath={join(dir, 'interview.md')}
      />,
    );

    // The simulated user must be asked at least once, and its answer must
    // land in the transcript as a real user_answer.
    await until(() => answered.length >= 1);
    expect(answered[0]).toContain('What is the scope?');
    // Give the interject a beat to flush into the transcript.
    await new Promise(r => setTimeout(r, 150));
    const entries = await readTranscript(transcriptPath);
    const answers = entries.filter(e => e.type === 'user_answer');
    expect(answers.length).toBeGreaterThanOrEqual(1);
    expect((answers[0] as { content: string }).content).toContain(
      'small internal tool',
    );
    unmount();
  });

  it('does not re-answer interview turns restored from a resumed session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bramble-auto-resume-'));
    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    // Both immediately ready so the restored session moves on quickly.
    claude.setResponse({ kind: 'interview', commentary: 'enough', ready: true });
    codex.setResponse({ kind: 'interview', commentary: 'enough', ready: true });

    const answered: string[] = [];
    const simulatedUser: Agent = {
      name: 'codex',
      // eslint-disable-next-line require-yield
      async *stream(ctx) {
        answered.push(ctx.prompt);
        return { raw: 'duplicate!' };
      },
    };

    // Resumed state: Q1 was already asked AND answered in the prior run.
    const initialState = {
      ...(await import('../orchestrator/state.js')).initialState('design x'),
      interviewIntensity: 'auto' as const,
      interview: [
        {
          speaker: 'claude' as const,
          commentary: '',
          question: 'Already answered?',
          ready: false,
          timestamp: '2026-07-12T00:00:00.000Z',
        },
      ],
      userAnswers: [
        { content: 'yes, previously', timestamp: '2026-07-12T00:00:01.000Z' },
      ],
    };

    const { unmount } = await renderSetup(
      <App
        agents={{ claude, codex }}
        prompt="design x"
        sessionName="auto-resume-test"
        initialState={initialState}
        initialInterview="auto"
        simulatedUser={simulatedUser}
        transcriptPath={join(dir, 'transcript.jsonl')}
        specPath={join(dir, 'spec.md')}
        debatePath={join(dir, 'debate.md')}
        interviewPath={join(dir, 'interview.md')}
      />,
    );

    await new Promise(r => setTimeout(r, 250));
    // The restored turn must not be re-answered.
    expect(answered).toHaveLength(0);
    unmount();
  });

  it('does not auto-answer at medium intensity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bramble-auto-off-'));
    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    claude.setResponse({ kind: 'interview', commentary: 'q', question: 'Scope?' });
    codex.setResponse({ kind: 'interview', commentary: 'q', question: 'Users?' });

    const answered: string[] = [];
    const simulatedUser: Agent = {
      name: 'codex',
      // eslint-disable-next-line require-yield
      async *stream(ctx) {
        answered.push(ctx.prompt);
        return { raw: 'should never be called' };
      },
    };

    const { unmount } = await renderSetup(
      <App
        agents={{ claude, codex }}
        prompt="design x"
        sessionName="auto-off-test"
        skipPromptEntry
        initialInterview="medium"
        simulatedUser={simulatedUser}
        transcriptPath={join(dir, 'transcript.jsonl')}
        specPath={join(dir, 'spec.md')}
        debatePath={join(dir, 'debate.md')}
        interviewPath={join(dir, 'interview.md')}
      />,
    );

    // Let the first interview turn land, then confirm no auto answer fired.
    await new Promise(r => setTimeout(r, 250));
    expect(answered).toHaveLength(0);
    unmount();
  });
});
