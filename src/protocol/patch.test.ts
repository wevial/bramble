import { describe, it, expect } from 'vitest';
import { parseAgentOutput } from './patch.js';

describe('parseAgentOutput', () => {
  it('parses a minimal commentary-only payload', () => {
    const result = parseAgentOutput(JSON.stringify({ commentary: 'looks ok' }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.value).toEqual({
      commentary: 'looks ok',
      proposal: null,
      verdict: null,
    });
  });

  it('parses a proposal', () => {
    const result = parseAgentOutput(
      JSON.stringify({
        commentary: "here's my draft",
        proposal: { body: '# Auth\n\nemail+password' },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.value.proposal).toEqual({ body: '# Auth\n\nemail+password' });
    expect(result.value.verdict).toBeNull();
  });

  it('parses an LGTM verdict', () => {
    const result = parseAgentOutput(
      JSON.stringify({ commentary: 'good', verdict: 'LGTM' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.value.verdict).toBe('LGTM');
  });

  it('parses a counter verdict', () => {
    const result = parseAgentOutput(
      JSON.stringify({ commentary: 'nope', verdict: 'counter' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.value.verdict).toBe('counter');
  });

  it('rejects invalid verdict values', () => {
    const result = parseAgentOutput(
      JSON.stringify({ commentary: 'x', verdict: 'maybe' }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects missing commentary', () => {
    const result = parseAgentOutput(JSON.stringify({ proposal: { body: 'x' } }));
    expect(result.ok).toBe(false);
  });

  it('rejects malformed JSON', () => {
    const result = parseAgentOutput('not json {');
    expect(result.ok).toBe(false);
  });

  it('extracts a JSON object embedded in surrounding prose', () => {
    const raw =
      'Here is my response:\n\n{"commentary": "ok", "verdict": "LGTM"}\n\nLet me know!';
    const result = parseAgentOutput(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.value.verdict).toBe('LGTM');
  });

  it('falls back to raw-as-commentary when parse fails and fallback is enabled', () => {
    const result = parseAgentOutput('just some free text with no json', {
      fallbackToCommentary: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(result.value.commentary).toBe('just some free text with no json');
    expect(result.value.proposal).toBeNull();
    expect(result.value.verdict).toBeNull();
  });
});
