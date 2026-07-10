import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState, reducer, type State } from './state.js';
import { rehydrateState } from './replay.js';
import { startDebate } from './runner.js';
import { FakeAgent } from '../agents/fake.js';
import {
  parseCaucusMessage,
  parseCaucusSynthesisMessage,
} from '../protocol/messages.js';
import { caucusPrompt, caucusSynthesisPrompt } from '../prompts/caucus.js';
import { debatePrompt, debateDeltaPrompt } from '../prompts/debate.js';
import type { TranscriptEntry } from '../docs/transcript.js';

function caucusState(): State {
  return { ...initialState('goal'), caucusEnabled: true };
}

describe('caucus state transitions', () => {
  it('interview mutual-ready routes to caucus when enabled (no criteria step)', () => {
    let s = caucusState();
    for (const speaker of ['claude', 'codex'] as const) {
      s = reducer(s, {
        type: 'interviewTurn',
        timestamp: '2026-07-01T00:00:00.000Z',
        turn: { speaker, commentary: '', question: null, ready: true },
      });
    }
    expect(s.phase).toBe('caucus');
  });

  it('criteriaApproved routes to caucus when enabled', () => {
    let s: State = {
      ...caucusState(),
      phase: 'criteria',
      criteriaStepEnabled: true,
    };
    s = reducer(s, { type: 'criteriaApproved', criteria: ['c1'] });
    expect(s.phase).toBe('caucus');
    expect(s.criteria).toEqual(['c1']);
  });

  it('userDone from caucus skips to debate without a summary', () => {
    const s = reducer(
      { ...caucusState(), phase: 'caucus' },
      { type: 'userDone' },
    );
    expect(s.phase).toBe('debate');
    expect(s.caucusSummary).toBeUndefined();
  });

  it('caucusTurn appends; caucusSynthesis records the turn, sets the summary, and opens debate', () => {
    let s: State = { ...caucusState(), phase: 'caucus' };
    s = reducer(s, {
      type: 'caucusTurn',
      timestamp: '2026-07-01T00:00:01.000Z',
      turn: { speaker: 'claude', commentary: 'stance', proposal: 'P1' },
    });
    expect(s.phase).toBe('caucus');
    expect(s.caucusTurns).toHaveLength(1);
    s = reducer(s, {
      type: 'caucusSynthesis',
      speaker: 'claude',
      commentary: 'merged',
      summary: 'UNIFIED',
      timestamp: '2026-07-01T00:00:02.000Z',
    });
    expect(s.phase).toBe('debate');
    expect(s.caucusSummary).toBe('UNIFIED');
    expect(s.caucusTurns).toHaveLength(2);
    expect(s.caucusTurns[1]!.synthesis).toBe(true);
  });

  it('without caucusEnabled the old transitions are untouched', () => {
    let s = initialState('goal');
    for (const speaker of ['claude', 'codex'] as const) {
      s = reducer(s, {
        type: 'interviewTurn',
        timestamp: '2026-07-01T00:00:00.000Z',
        turn: { speaker, commentary: '', question: null, ready: true },
      });
    }
    expect(s.phase).toBe('debate');
  });
});

describe('caucus message parsing', () => {
  it('parses a proposal and defaults missing commentary', () => {
    const r = parseCaucusMessage('{"proposal": "use sqlite"}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ commentary: '', proposal: 'use sqlite' });
  });

  it('parses a synthesis and rejects a proposal-shaped payload', () => {
    const ok = parseCaucusSynthesisMessage(
      '{"commentary": "n", "summary": "s"}',
    );
    expect(ok.ok).toBe(true);
    const bad = parseCaucusSynthesisMessage('{"proposal": "not a summary"}');
    expect(bad.ok).toBe(false);
  });
});

describe('caucus prompts', () => {
  it('proposal prompt NEVER leaks other proposals (independence)', () => {
    const s: State = {
      ...caucusState(),
      phase: 'caucus',
      caucusTurns: [
        {
          speaker: 'claude',
          commentary: 'stance',
          proposal: 'CLAUDE-SECRET-POSITION',
          timestamp: '2026-07-01T00:00:01.000Z',
        },
      ],
    };
    const prompt = caucusPrompt({ state: s, speaker: 'codex' });
    expect(prompt).not.toContain('CLAUDE-SECRET-POSITION');
    expect(prompt).toContain('private');
  });

  it('synthesis prompt includes every proposal', () => {
    const s: State = {
      ...caucusState(),
      phase: 'caucus',
      caucusTurns: [
        {
          speaker: 'claude',
          commentary: '',
          proposal: 'POSITION-A',
          timestamp: '2026-07-01T00:00:01.000Z',
        },
        {
          speaker: 'codex',
          commentary: '',
          proposal: 'POSITION-B',
          timestamp: '2026-07-01T00:00:02.000Z',
        },
      ],
    };
    const prompt = caucusSynthesisPrompt({ state: s, speaker: 'claude' });
    expect(prompt).toContain('POSITION-A');
    expect(prompt).toContain('POSITION-B');
  });

  it('debate prompt pins the caucus summary; delta sends it only on a persona\'s first turn', () => {
    const s: State = {
      ...caucusState(),
      phase: 'debate',
      caucusSummary: 'UNIFIED-START',
    };
    expect(debatePrompt({ state: s, speaker: 'claude' })).toContain(
      'UNIFIED-START',
    );
    expect(debateDeltaPrompt({ state: s, speaker: 'claude' })).toContain(
      'UNIFIED-START',
    );
    const later: State = {
      ...s,
      debate: [
        {
          speaker: 'claude',
          commentary: '',
          edits: [],
          applied: [],
          rejected: [],
          verdict: 'continue',
          charsChanged: 0,
          round: 1,
          timestamp: '2026-07-01T00:00:03.000Z',
        },
      ],
    };
    expect(debateDeltaPrompt({ state: later, speaker: 'claude' })).not.toContain(
      'UNIFIED-START',
    );
    // codex hasn't spoken yet — still gets the summary.
    expect(debateDeltaPrompt({ state: later, speaker: 'codex' })).toContain(
      'UNIFIED-START',
    );
  });
});

describe('caucus end-to-end through the runner', () => {
  it('runs proposals → synthesis → debate and survives transcript replay', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bramble-caucus-'));
    const transcriptPath = join(tmp, 'transcript.jsonl');
    try {
      const claude = new FakeAgent('claude');
      const codex = new FakeAgent('codex');
      claude.setResponses([
        { kind: 'interview', commentary: '', ready: true },
        { kind: 'caucus', commentary: 'stance A', proposal: 'PROPOSAL-A' },
        // claude is the first primary → it also gets the synthesis turn.
        { kind: 'caucus_synthesis', commentary: 'merged', summary: 'UNIFIED-XYZ' },
        {
          kind: 'debate',
          commentary: 'seed',
          edits: [{ find: '', replace: '# Spec' }],
          verdict: 'lgtm',
        },
      ]);
      codex.setResponses([
        { kind: 'interview', commentary: '', ready: true },
        { kind: 'caucus', commentary: 'stance B', proposal: 'PROPOSAL-B' },
        { kind: 'debate', commentary: 'agree', edits: [], verdict: 'lgtm' },
      ]);

      // Mutual LGTM pauses for signoff — confirm exactly then. A blind
      // periodic done_interview() poll could fire during the caucus and
      // skip it (userDone from caucus = skip-to-debate by design).
      let confirmed = false;
      const handle = startDebate({
        agents: { claude, codex },
        prompt: 'tiny goal',
        caucusStep: true,
        transcriptPath,
        onState: s => {
          if (s.awaitingSignoff && !confirmed) {
            confirmed = true;
            setTimeout(() => handle.done_interview(), 0);
          }
        },
      });
      const final = await handle.done;

      expect(final.caucusSummary).toBe('UNIFIED-XYZ');
      expect(final.caucusTurns.map(t => t.proposal)).toEqual([
        'PROPOSAL-A',
        'PROPOSAL-B',
        'UNIFIED-XYZ',
      ]);
      expect(final.phase).toBe('done');

      const entries = (await readFile(transcriptPath, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l) as TranscriptEntry);
      expect(entries.filter(e => e.type === 'caucus_turn')).toHaveLength(2);
      expect(entries.filter(e => e.type === 'caucus_synthesis')).toHaveLength(1);

      const replayed = rehydrateState(entries);
      expect(replayed).not.toBeNull();
      expect(replayed!.caucusSummary).toBe('UNIFIED-XYZ');
      expect(replayed!.caucusTurns).toHaveLength(3);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
