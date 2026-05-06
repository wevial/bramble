import React from 'react';
import { describe, it, expect } from 'vitest';
import { ConversationPane, buildConversation } from './ConversationPane.js';
import { initialState, type State } from '../orchestrator/state.js';
import { renderFrame } from './test-renderer.js';

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
  it('shows the bramble sparkle for the user', async () => {
    const { frame, unmount } = await renderFrame(<ConversationPane state={withMix()} />);
    const out = frame;
    expect(out).toMatch(/✦.*You/);
    expect(out).toContain('just me');
    unmount();
  });

  it('renders Claude and Codex labels', async () => {
    const { frame, unmount } = await renderFrame(<ConversationPane state={withMix()} />);
    const out = frame;
    expect(out).toContain('Claude');
    expect(out).toContain('Codex');
    unmount();
  });

  it('shows the question line for an interview turn', async () => {
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
    const { frame, unmount } = await renderFrame(<ConversationPane state={s} />);
    expect(frame).toContain('who are users?');
    unmount();
  });

  it('shows a starting-up placeholder when there are no entries yet', async () => {
    const s = initialState('design x');
    const { frame, unmount } = await renderFrame(<ConversationPane state={s} />);
    expect(frame).toMatch(/Waiting|starting up/);
    unmount();
  });

  it('shows lgtm verdict pill on a debate turn', async () => {
    const { frame, unmount } = await renderFrame(<ConversationPane state={withMix()} />);
    expect(frame).toContain('lgtm');
    unmount();
  });

  it('honors maxEntries by tailing the list', async () => {
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
    const { frame, unmount } = await renderFrame(
      <ConversationPane state={many} maxEntries={3} />,
    );
    const out = frame;
    expect(out).toContain('turn-11');
    expect(out).not.toContain('turn-0');
    unmount();
  });
});
