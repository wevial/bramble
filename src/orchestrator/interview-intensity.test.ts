import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeAgent } from '../agents/fake.js';
import { startDebate } from './runner.js';
import { initialState, postScoutPhase, reducer, type State } from './state.js';
import { rehydrateState } from './replay.js';
import { readTranscript } from '../docs/transcript.js';
import { interviewPrompt } from '../prompts/interview.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bramble-intensity-'));
});

const CTX = { cwd: '/nowhere', files: [], entries: [] };

describe('interview intensity — phase routing', () => {
  it("scoutComplete routes 'none' past the interview into criteria", () => {
    let s: State = {
      ...initialState('goal'),
      phase: 'scout',
      scoutEnabled: true,
      interviewIntensity: 'none',
      criteriaStepEnabled: true,
    };
    s = reducer(s, { type: 'scoutComplete', context: CTX });
    expect(s.phase).toBe('criteria');
  });

  it("'none' without criteria routes to caucus when enabled, else debate", () => {
    const base = { ...initialState('goal'), interviewIntensity: 'none' as const };
    expect(postScoutPhase({ ...base, caucusEnabled: true })).toBe('caucus');
    expect(postScoutPhase(base)).toBe('debate');
  });

  it('every other intensity still enters the interview', () => {
    for (const level of ['auto', 'low', 'medium', 'high'] as const) {
      const s: State = { ...initialState('goal'), interviewIntensity: level };
      expect(postScoutPhase(s)).toBe('interview');
    }
  });
});

describe('interview intensity — prompts', () => {
  it('low and high weave a grilling hint into the instruction; medium does not', () => {
    const mk = (level?: 'low' | 'medium' | 'high') =>
      interviewPrompt({
        state: { ...initialState('goal'), interviewIntensity: level },
        speaker: 'claude',
      });
    expect(mk('low')).toContain('intensity is LOW');
    expect(mk('high')).toContain('intensity is HIGH');
    expect(mk('medium')).not.toContain('intensity is');
    expect(mk(undefined)).not.toContain('intensity is');
  });
});

describe("interview intensity — 'none' end to end", () => {
  it('skips the interview, stamps the session entry, and survives replay', async () => {
    const claude = new FakeAgent('claude');
    const codex = new FakeAgent('codex');
    claude.setResponses([
      {
        kind: 'debate',
        commentary: 'seed',
        edits: [{ find: '', replace: '# Spec' }],
        verdict: 'lgtm',
      },
    ]);
    codex.setResponses([{ kind: 'debate', commentary: 'ok', edits: [], verdict: 'lgtm' }]);

    const transcriptPath = join(tmp, 'transcript.jsonl');
    const handle = startDebate({
      agents: { claude, codex },
      prompt: 'skip the grilling',
      interviewIntensity: 'none',
      transcriptPath,
    });
    // The signoff pause arrives after mutual LGTM; confirm it.
    const confirm = setInterval(() => handle.done_interview(), 25);
    const final = await handle.done;
    clearInterval(confirm);

    expect(final.interview).toHaveLength(0);
    expect(final.userAnswers).toHaveLength(0);
    expect(final.phase).toBe('done');
    expect(final.spec).toContain('# Spec');

    const entries = await readTranscript(transcriptPath);
    expect(entries[0]!.type).toBe('session');
    expect((entries[0] as { interviewIntensity?: string }).interviewIntensity).toBe('none');

    const replayed = rehydrateState(entries);
    expect(replayed?.interviewIntensity).toBe('none');
    expect(replayed?.interview).toHaveLength(0);
  });

  it('replay restores the intensity from the session entry before any turn', () => {
    const replayed = rehydrateState([
      {
        type: 'session',
        prompt: 'goal',
        config: initialState('goal').config,
        interviewIntensity: 'high',
        timestamp: '2026-07-12T00:00:00.000Z',
      },
    ]);
    expect(replayed?.interviewIntensity).toBe('high');
    expect(replayed?.phase).toBe('interview');
  });
});
