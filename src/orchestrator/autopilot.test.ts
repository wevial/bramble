import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeAgent } from '../agents/fake.js';
import type { Agent, StreamTail, Token, TurnContext } from '../agents/agent.js';
import { CLAUDE_PERSONA, CODEX_PERSONA } from '../personas/personas.js';
import { runAutopilot } from './autopilot.js';

/** A simulated user that records how many questions it was asked. */
function stubUser(): Agent & { asked: string[] } {
  const asked: string[] = [];
  return {
    name: 'codex',
    asked,
    async *stream(ctx: TurnContext): AsyncGenerator<Token, StreamTail | void, void> {
      asked.push(ctx.prompt);
      return { raw: 'Answer: use sensible defaults.' };
    },
  };
}

function tmpTranscript(): string {
  return join(mkdtempSync(join(tmpdir(), 'bramble-ap-test-')), 't.jsonl');
}

const silent = () => {};

describe('runAutopilot', () => {
  it('answers interview questions then forces the debate and completes', async () => {
    // Both personas ask one question, then repeat "ready" forever afterward.
    const claude = new FakeAgent('claude');
    claude.setResponses([
      { kind: 'interview', commentary: 'q', question: 'Who uses this?' },
      { kind: 'interview', commentary: 'ok', ready: true },
      { kind: 'debate', commentary: 'seed', edits: [{ find: '', replace: '# Spec\n' }] },
      { kind: 'debate', commentary: 'done', verdict: 'lgtm' },
    ]);
    const codex = new FakeAgent('codex');
    codex.setResponses([
      { kind: 'interview', commentary: 'q', question: 'Which platform?' },
      { kind: 'interview', commentary: 'ok', ready: true },
      { kind: 'debate', commentary: 'ok', verdict: 'lgtm' },
    ]);

    const user = stubUser();
    const final = await runAutopilot({
      agents: { claude, codex },
      personas: [CLAUDE_PERSONA, CODEX_PERSONA],
      prompt: 'build a thing',
      transcriptPath: tmpTranscript(),
      simulatedUser: user,
      maxAnswers: 3,
      maxRounds: 2,
      timeoutMs: 20_000,
      criteriaStep: false,
      scoutStep: false,
      log: silent,
    });

    // The simulated user was asked at least the two interview questions, and
    // each prompt carried the original goal + the question text.
    expect(user.asked.length).toBeGreaterThanOrEqual(2);
    expect(user.asked[0]).toContain('build a thing');
    expect(user.asked.some(p => p.includes('Who uses this?'))).toBe(true);
    // The run reached a terminal phase rather than hanging on interview input.
    expect(final.phase).toBe('done');
    expect(final.interview.length).toBeGreaterThanOrEqual(2);
  }, 25_000);

  it('force-ends the interview once maxAnswers is reached', async () => {
    // Personas that NEVER signal ready — only the maxAnswers cap ends the
    // interview. Without the cap this would spin forever.
    const asker = (name: 'claude' | 'codex') => {
      const a = new FakeAgent(name);
      a.setResponses([
        { kind: 'interview', commentary: 'q', question: `${name} question?` },
        // After the interview is force-ended, debate turns:
        { kind: 'debate', commentary: 'lgtm', verdict: 'lgtm' },
      ]);
      return a;
    };
    const user = stubUser();
    const final = await runAutopilot({
      agents: { claude: asker('claude'), codex: asker('codex') },
      personas: [CLAUDE_PERSONA, CODEX_PERSONA],
      prompt: 'goal',
      transcriptPath: tmpTranscript(),
      simulatedUser: user,
      maxAnswers: 2,
      maxRounds: 1,
      timeoutMs: 20_000,
      criteriaStep: false,
      scoutStep: false,
      log: silent,
    });

    // Exactly maxAnswers questions answered before the debate was forced.
    expect(user.asked.length).toBe(2);
    expect(final.phase).toBe('done');
  }, 25_000);

  it('drives the criteria phase (locks it) instead of hanging on its wait', async () => {
    // With criteriaStep on, a natural interview end routes through criteria,
    // which pauses for user input after every proposal. Autopilot must lock it
    // (done_interview) or the run hangs — this is the regression that showed up
    // as "stuck on codex" in a live run. Fakes emit debate-shaped JSON in the
    // criteria phase; it parses to an empty proposal, which is enough to
    // exercise the propose→lock→debate handoff.
    const mk = (name: 'claude' | 'codex') => {
      const a = new FakeAgent(name);
      a.setResponses([
        { kind: 'interview', commentary: 'q', question: `${name}?` },
        { kind: 'interview', commentary: 'ready', ready: true },
        { kind: 'debate', commentary: 'lgtm', verdict: 'lgtm' },
      ]);
      return a;
    };
    const final = await runAutopilot({
      agents: { claude: mk('claude'), codex: mk('codex') },
      personas: [CLAUDE_PERSONA, CODEX_PERSONA],
      prompt: 'goal',
      transcriptPath: tmpTranscript(),
      simulatedUser: stubUser(),
      maxAnswers: 5,
      maxRounds: 2,
      timeoutMs: 20_000,
      criteriaStep: true,
      scoutStep: false,
      log: silent,
    });

    // Reached a terminal phase — did not hang on the criteria wait.
    expect(final.phase).toBe('done');
    expect(final.criteriaTurns.length).toBeGreaterThanOrEqual(2);
  }, 25_000);
});
