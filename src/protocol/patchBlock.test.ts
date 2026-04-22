import { describe, it, expect } from 'vitest';
import { extractPatchBlock, buildAgentOutputFromModel } from './patchBlock.js';

describe('extractPatchBlock', () => {
  it('returns commentary = full text and no patch when no <patch> tag', () => {
    const r = extractPatchBlock('just free form text here');
    expect(r.commentary).toBe('just free form text here');
    expect(r.patchJson).toBeNull();
  });

  it('splits commentary and patch body on <patch>...</patch>', () => {
    const raw =
      'Some commentary first.\n\n<patch>\n{"proposal":{"body":"X"}}\n</patch>';
    const r = extractPatchBlock(raw);
    expect(r.commentary).toBe('Some commentary first.');
    expect(r.patchJson).toBe('{"proposal":{"body":"X"}}');
  });

  it('trims commentary and patch contents', () => {
    const raw = '\n   hi   \n<patch>\n  {"verdict":"LGTM"}  \n</patch>\n';
    const r = extractPatchBlock(raw);
    expect(r.commentary).toBe('hi');
    expect(r.patchJson).toBe('{"verdict":"LGTM"}');
  });

  it('handles unclosed <patch> by treating rest as patch body', () => {
    const raw = 'pre\n<patch>\n{"ver';
    const r = extractPatchBlock(raw);
    expect(r.commentary).toBe('pre');
    expect(r.patchJson).toBe('{"ver');
  });
});

describe('buildAgentOutputFromModel', () => {
  it('returns plain commentary when no patch block', () => {
    const r = buildAgentOutputFromModel('just thinking out loud');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.commentary).toBe('just thinking out loud');
      expect(r.value.proposal).toBeNull();
      expect(r.value.verdict).toBeNull();
    }
  });

  it('merges commentary + parsed patch fields', () => {
    const raw =
      'Proposing auth.\n<patch>\n{"proposal":{"body":"# Auth"}, "verdict":"counter"}\n</patch>';
    const r = buildAgentOutputFromModel(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.commentary).toBe('Proposing auth.');
      expect(r.value.proposal?.body).toBe('# Auth');
      expect(r.value.verdict).toBe('counter');
    }
  });

  it('degrades gracefully when patch JSON is malformed (commentary preserved)', () => {
    const raw = 'hi\n<patch>\nnot json at all\n</patch>';
    const r = buildAgentOutputFromModel(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.commentary).toBe('hi');
      expect(r.value.proposal).toBeNull();
      expect(r.value.verdict).toBeNull();
    }
  });

  it('strips ```json code fences inside the <patch> block', () => {
    const raw =
      'critique\n<patch>\n```json\n{"verdict":"LGTM"}\n```\n</patch>';
    const r = buildAgentOutputFromModel(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.commentary).toBe('critique');
      expect(r.value.verdict).toBe('LGTM');
    }
  });

  it('strips bare ``` fences inside the <patch> block', () => {
    const raw = 'x\n<patch>\n```\n{"verdict":"counter"}\n```\n</patch>';
    const r = buildAgentOutputFromModel(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.verdict).toBe('counter');
  });
});
