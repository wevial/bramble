import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ConversationPane, buildConversation } from './ConversationPane.js';
import { initialState, type State } from '../orchestrator/state.js';

const t1 = '2026-04-28T14:32:11.000Z';
const t2 = '2026-04-28T14:32:21.000Z';
const t3 = '2026-04-28T14:32:43.000Z';
const t4 = '2026-04-28T14:33:07.000Z';

function withMix(): State {
  return {
    ...initialState('design x'),
    phase: 'debate',
    interview: [
      {
        speaker: 'claude',
        commentary: 'starting',
        question: 'who?',
        ready: false,
        timestamp: t2,
      },
    ],
    userAnswers: [{ content: 'just me', timestamp: t1 }],
    debate: [
      {
        speaker: 'codex',
        commentary: 'agree',
        edits: [],
        applied: [],
        rejected: [],
        verdict: 'lgtm',
        charsChanged: 0,
        round: 1,
        timestamp: t4,
      },
    ],
  };
}

describe('buildConversation', () => {
  it('merges user answers, interview turns, and debate turns in timestamp order', () => {
    const items = buildConversation(withMix());
    expect(items.map(i => i.kind)).toEqual(['user', 'agent', 'debate']);
  });
});

describe('ConversationPane', () => {
  it('shows the bramble sparkle for the user', () => {
    const { lastFrame } = render(<ConversationPane state={withMix()} />);
    const out = lastFrame() ?? '';
    expect(out).toMatch(/✦.*You/);
    expect(out).toContain('just me');
  });

  it('renders Claude and Codex labels', () => {
    const { lastFrame } = render(<ConversationPane state={withMix()} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('Claude');
    expect(out).toContain('Codex');
  });

  it('shows the question line for an interview turn', () => {
    const s: State = {
      ...initialState('design x'),
      interview: [
        {
          speaker: 'claude',
          commentary: 'context',
          question: 'who are users?',
          ready: false,
          timestamp: t2,
        },
      ],
    };
    const { lastFrame } = render(<ConversationPane state={s} />);
    expect(lastFrame() ?? '').toContain('who are users?');
  });

  it('shows a starting-up placeholder when there are no entries yet', () => {
    const s = initialState('design x');
    const { lastFrame } = render(<ConversationPane state={s} />);
    expect(lastFrame() ?? '').toMatch(/Waiting|starting up/);
  });

  it('shows lgtm verdict pill on a debate turn', () => {
    const { lastFrame } = render(<ConversationPane state={withMix()} />);
    expect(lastFrame() ?? '').toContain('lgtm');
  });

  it('honors maxEntries by tailing the list', () => {
    const many: State = {
      ...initialState('x'),
      phase: 'debate',
      debate: Array.from({ length: 12 }, (_, i) => ({
        speaker: i % 2 === 0 ? ('claude' as const) : ('codex' as const),
        commentary: `turn-${i}`,
        edits: [],
        applied: [],
        rejected: [],
        verdict: 'continue' as const,
        charsChanged: 0,
        round: Math.floor(i / 2) + 1,
        timestamp: `2026-04-28T14:${String(40 + i).padStart(2, '0')}:00.000Z`,
      })),
    };
    const { lastFrame } = render(
      <ConversationPane state={many} maxEntries={3} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('turn-11');
    expect(out).not.toContain('turn-0');
  });
});
