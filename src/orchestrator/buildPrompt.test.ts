import { describe, it, expect } from 'vitest';
import { buildDeltaPrompt, buildPrompt } from './runner.js';
import { initialState, type State } from './types.js';

function stateWith(partial: Partial<State>): State {
  return { ...initialState, ...partial };
}

describe('buildPrompt', () => {
  it('includes the goal and identifies the speaker against their opponent', () => {
    const out = buildPrompt('design auth', initialState, 'claude', 'auto');
    expect(out).toContain('design auth');
    expect(out).toContain('You are claude');
    expect(out).toContain('codex');
  });

  it('frames the interaction as a debate aiming at convergence, not rubber-stamping', () => {
    const out = buildPrompt('x', initialState, 'codex', 'auto');
    expect(out.toLowerCase()).toMatch(/debate|disagree|rubber[- ]?stamp/);
  });

  it('tells the agent to open with a concrete proposal when no draft exists', () => {
    const out = buildPrompt('x', initialState, 'claude', 'auto');
    expect(out).toMatch(/propos/i);
    expect(out).toContain('<patch>');
  });

  it('forbids LGTM on a self-authored draft and explains who can accept', () => {
    const state = stateWith({
      currentDraft: { body: '# body', proposer: 'claude' },
    });
    const out = buildPrompt('x', state, 'claude', 'auto');
    expect(out).toMatch(/can'?t LGTM|cannot LGTM|only codex can/i);
  });

  it('offers the three response options when facing the opponent draft', () => {
    const state = stateWith({
      currentDraft: { body: '# body', proposer: 'codex' },
    });
    const out = buildPrompt('x', state, 'claude', 'auto');
    expect(out).toContain('LGTM');
    expect(out).toMatch(/counter[- ]?propose/i);
    expect(out).toMatch(/critique|commentary/i);
  });

  it('includes collab-mode guidance only when mode is collab', () => {
    const auto = buildPrompt('x', initialState, 'claude', 'auto');
    const collab = buildPrompt('x', initialState, 'claude', 'collab');
    expect(collab).toMatch(/collab|human/i);
    expect(auto).not.toMatch(/human is reviewing/i);
  });

  it('includes user interjections inline in chronological debate order', () => {
    const state = stateWith({
      transcript: [
        { speaker: 'claude', content: 'proposal one', timestamp: 't1' },
        { speaker: 'user', content: 'must use passkeys', timestamp: 't2' },
        { speaker: 'codex', content: 'counter', timestamp: 't3' },
      ],
    });
    const out = buildPrompt('x', state, 'claude', 'collab');
    expect(out).toContain('must use passkeys');
    expect(out).toContain('## user');
    expect(out).not.toContain('User guidance');
    // User turn must appear between the two agent turns, preserving order.
    const idxClaude = out.indexOf('proposal one');
    const idxUser = out.indexOf('must use passkeys');
    const idxCodex = out.indexOf('counter');
    expect(idxClaude).toBeLessThan(idxUser);
    expect(idxUser).toBeLessThan(idxCodex);
  });

  it('includes prior debate turns under a debate-so-far section', () => {
    const state = stateWith({
      transcript: [
        { speaker: 'claude', content: 'turn one', timestamp: 't1' },
        { speaker: 'codex', content: 'turn two', timestamp: 't2' },
      ],
    });
    const out = buildPrompt('x', state, 'claude', 'auto');
    expect(out).toContain('Debate so far');
    expect(out).toContain('turn one');
    expect(out).toContain('turn two');
  });

  // Prompt-caching: server-side prompt caching matches on the longest shared
  // token prefix. For the same speaker, the prompt for turn N+1 should share a
  // strictly longer prefix with turn N than everything before the section that
  // actually changed this turn. That means stable-append sections (user
  // guidance, debate so far) must come before turn-variable sections (current
  // draft, your turn).
  describe('stable prefix for prompt-caching', () => {
    it('places debate-so-far before current-draft so the prefix keeps growing', () => {
      const state = stateWith({
        currentDraft: { body: '# draft v1', proposer: 'codex' },
        transcript: [
          { speaker: 'claude', content: 'turn one', timestamp: 't1' },
          { speaker: 'codex', content: 'turn two', timestamp: 't2' },
        ],
      });
      const out = buildPrompt('x', state, 'claude', 'auto');
      expect(out.indexOf('Debate so far')).toBeGreaterThan(-1);
      expect(out.indexOf('Current draft')).toBeGreaterThan(
        out.indexOf('Debate so far'),
      );
    });

    it('user interjections extend — do not invalidate — the prior prefix', () => {
      const t1 = { speaker: 'claude' as const, content: 'turn one', timestamp: 't1' };
      const t2 = { speaker: 'codex' as const, content: 'turn two', timestamp: 't2' };
      const before = buildPrompt(
        'x',
        stateWith({ transcript: [t1, t2] }),
        'claude',
        'collab',
      );
      const after = buildPrompt(
        'x',
        stateWith({
          transcript: [
            t1,
            t2,
            { speaker: 'user', content: 'please be concise', timestamp: 't3' },
          ],
        }),
        'claude',
        'collab',
      );
      // `after` must start with every byte of `before` up to the end of turn two.
      const turnTwoEnd = before.indexOf('turn two') + 'turn two'.length;
      expect(after.slice(0, turnTwoEnd)).toBe(before.slice(0, turnTwoEnd));
    });

    it('consecutive same-speaker turns share a prefix through the prior debate', () => {
      const t1 = { speaker: 'claude' as const, content: 'turn one', timestamp: 't1' };
      const t2 = { speaker: 'codex' as const, content: 'turn two', timestamp: 't2' };
      const t3 = { speaker: 'claude' as const, content: 'turn three', timestamp: 't3' };
      const t4 = { speaker: 'codex' as const, content: 'turn four', timestamp: 't4' };

      // claude's 2nd turn: transcript has t1..t2, current draft from codex (t2).
      const atTurn2 = buildPrompt(
        'x',
        stateWith({
          currentDraft: { body: '# draft v1', proposer: 'codex' },
          transcript: [t1, t2],
        }),
        'claude',
        'auto',
      );
      // claude's 3rd turn: two more turns appended, current draft replaced.
      const atTurn3 = buildPrompt(
        'x',
        stateWith({
          currentDraft: { body: '# draft v2', proposer: 'codex' },
          transcript: [t1, t2, t3, t4],
        }),
        'claude',
        'auto',
      );

      // The shared prefix must reach through the full Debate-so-far of turn 2.
      const turn2DebateEnd = atTurn2.indexOf('turn two') + 'turn two'.length;
      expect(turn2DebateEnd).toBeGreaterThan(0);
      expect(atTurn3.slice(0, turn2DebateEnd)).toBe(atTurn2.slice(0, turn2DebateEnd));
    });
  });
});

describe('buildDeltaPrompt', () => {
  it('includes only turns since the speaker last responded', () => {
    const state = stateWith({
      currentDraft: { body: '# draft v2', proposer: 'codex' },
      transcript: [
        { speaker: 'claude', content: 'old claude turn', timestamp: 't1' },
        { speaker: 'codex', content: 'codex reply', timestamp: 't2' },
        { speaker: 'user', content: 'human constraint', timestamp: 't3' },
      ],
    });

    const out = buildDeltaPrompt('design auth', state, 'claude', 'collab');
    expect(out).toContain('design auth');
    expect(out).toContain('codex reply');
    expect(out).toContain('human constraint');
    expect(out).toContain('# draft v2');
    expect(out).not.toContain('old claude turn');
    expect(out).not.toContain('Debate so far');
  });

  // Reviewer concern: if Claude's persistent session dropped any earlier
  // user-side context (a quietly restarted subprocess, a CLI-side truncation,
  // etc.), the delta prompt needs to re-assert the role framing on every turn
  // so the agent can't drift into a different stance.
  it('reasserts the role framing on every delta', () => {
    const state = stateWith({
      transcript: [
        { speaker: 'claude', content: 'old', timestamp: 't1' },
        { speaker: 'codex', content: 'new', timestamp: 't2' },
      ],
    });
    const out = buildDeltaPrompt('design auth', state, 'claude', 'auto');
    expect(out).toContain('You are claude');
    expect(out).toMatch(/debat/i);
  });
});
