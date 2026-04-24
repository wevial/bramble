import { describe, it, expect } from 'vitest';
import { buildPrompt } from './runner.js';
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

  it('flags user interjections as hard constraints the agent must reflect', () => {
    const state = stateWith({
      transcript: [
        { speaker: 'user', content: 'must use passkeys', timestamp: 't' },
      ],
    });
    const out = buildPrompt('x', state, 'claude', 'collab');
    expect(out).toContain('must use passkeys');
    expect(out).toMatch(/constraint|incorporate/i);
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
});
