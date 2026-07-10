import { describe, it, expect } from 'bun:test';
import { generateCheckpoint } from './checkpoint.js';
import { initialState, type State } from '../orchestrator/state.js';
import {
  CLAUDE_PERSONA,
  CODEX_PERSONA,
  SPECIALIST_PERSONAS,
} from '../personas/personas.js';

const SECURITY = SPECIALIST_PERSONAS.find(p => p.id === 'security')!;

function doneState(): State {
  const base = initialState('build a coin-flip CLI\nwith extra detail');
  return {
    ...base,
    phase: 'done',
    endReason: 'mutual_lgtm',
    criteria: ['Exits 0 on valid input', 'Rejects unknown flags'],
    spec: [
      '# Spec',
      '## Goals',
      'Flip coins.',
      '## Out of scope',
      '- multi-coin batch mode',
      '## Details',
      '```md',
      '# not a heading — inside a fence',
      '```',
    ].join('\n'),
    round: 2,
    debate: [
      {
        speaker: 'claude',
        commentary:
          'Seeded the spec. We should defer persistence to v2 since the CLI is stateless.',
        edits: [],
        applied: [{ find: '', replace: '# Spec' }],
        rejected: [],
        verdict: 'continue',
        charsChanged: 120,
        round: 1,
        timestamp: '2026-07-01T00:00:01.000Z',
      },
      {
        speaker: 'codex',
        commentary: 'Tightened goals | added error handling.',
        edits: [],
        applied: [],
        rejected: [
          { kind: 'no_match', count: 0, edit: { find: 'x', replace: 'y' } },
        ],
        verdict: 'continue',
        charsChanged: 40,
        round: 1,
        timestamp: '2026-07-01T00:00:02.000Z',
      },
      {
        speaker: 'claude',
        commentary: 'lgtm',
        edits: [],
        applied: [],
        rejected: [],
        verdict: 'lgtm',
        charsChanged: 0,
        round: 2,
        timestamp: '2026-07-01T00:00:03.000Z',
      },
      {
        speaker: 'codex',
        commentary: 'lgtm',
        edits: [],
        applied: [],
        rejected: [],
        verdict: 'lgtm',
        charsChanged: 0,
        round: 2,
        timestamp: '2026-07-01T00:00:04.000Z',
      },
    ],
  };
}

const PERSONAS = [CLAUDE_PERSONA, CODEX_PERSONA];

describe('generateCheckpoint', () => {
  it('renders every section for a finished session', () => {
    const doc = generateCheckpoint(doneState(), PERSONAS);
    expect(doc).toContain('# Checkpoint — build a coin-flip CLI');
    expect(doc).toContain('consensus — every primary signed off');
    expect(doc).toContain('4 turns over 2 rounds');
    expect(doc).toContain('## Spec at a glance');
    expect(doc).toContain('- [ ] Exits 0 on valid input');
    expect(doc).toContain('## Decision journey');
    expect(doc).toContain('## Voices');
    expect(doc).toContain('## Deferred & open items');
  });

  it('collects deferrals from commentary and spec open-sections, deduped', () => {
    const doc = generateCheckpoint(doneState(), PERSONAS);
    expect(doc).toContain(
      'We should defer persistence to v2 since the CLI is stateless. _(claude, round 1)_',
    );
    expect(doc).toContain('multi-coin batch mode _(spec)_');
  });

  it('escapes pipes in table cells and skips fenced pseudo-headings', () => {
    const doc = generateCheckpoint(doneState(), PERSONAS);
    expect(doc).toContain('Tightened goals \\| added error handling.');
    expect(doc).not.toContain('not a heading');
  });

  it('quotes the last substantive comment, not a bare lgtm', () => {
    const doc = generateCheckpoint(doneState(), PERSONAS);
    // claude's final turn said only "lgtm"; the quote falls back to the
    // earlier real commentary.
    expect(doc).toContain('> Seeded the spec.');
    expect(doc).not.toContain('> lgtm');
  });

  it('marks specialists and omits personas with no debate turns', () => {
    const s = doneState();
    const withSpecialist: State = {
      ...s,
      activePersonas: ['claude', 'codex', 'security'],
      debate: [
        ...s.debate,
        {
          speaker: 'security',
          commentary:
            'No secrets handling in scope; revisit threat model before deploy.',
          edits: [],
          applied: [],
          rejected: [],
          verdict: 'continue',
          charsChanged: 0,
          round: 1,
          timestamp: '2026-07-01T00:00:05.000Z',
        },
      ],
    };
    const doc = generateCheckpoint(withSpecialist, [...PERSONAS, SECURITY]);
    expect(doc).toContain(`### ${SECURITY.label} (specialist)`);

    const noTurns: State = { ...s, activePersonas: ['claude', 'codex', 'security'] };
    const doc2 = generateCheckpoint(noTurns, [...PERSONAS, SECURITY]);
    expect(doc2).not.toContain(`### ${SECURITY.label}`);
  });

  it('degrades gracefully for an unfinished, empty session', () => {
    const doc = generateCheckpoint(initialState('just started'), PERSONAS);
    expect(doc).toContain('# Checkpoint — just started');
    expect(doc).toContain('session still in interview phase');
    expect(doc).not.toContain('## Decision journey');
    expect(doc).not.toContain('## Voices');
    expect(doc).not.toContain('## Success criteria');
    expect(doc).not.toContain('## Deferred');
  });

  it('describes each end reason distinctly', () => {
    const s = doneState();
    const reasons: Array<[State['endReason'], string]> = [
      ['max_rounds', 'round cap reached'],
      ['edit_decay', 'converged'],
      ['user_done', 'closed by the user'],
    ];
    for (const [endReason, needle] of reasons) {
      expect(
        generateCheckpoint({ ...s, endReason }, PERSONAS),
      ).toContain(needle);
    }
  });
});
