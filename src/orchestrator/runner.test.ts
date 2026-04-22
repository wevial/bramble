import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeAgent } from '../agents/fake.js';
import { runDebate } from './runner.js';

function makeAgents() {
  const claude = new FakeAgent('claude');
  const codex = new FakeAgent('codex');
  claude.setResponse('proposal-from-claude');
  codex.setResponse('critique-from-codex');
  return { claude, codex };
}

describe('runDebate (Phase 0 walking skeleton)', () => {
  it('runs N alternating turns and returns the final state', async () => {
    const { claude, codex } = makeAgents();
    const dir = mkdtempSync(join(tmpdir(), 'bramble-run-'));
    const transcriptPath = join(dir, 'transcript.jsonl');

    const final = await runDebate({
      agents: { claude, codex },
      prompt: 'design an auth system',
      rounds: 2,
      transcriptPath,
    });

    // 2 rounds => 4 turns (claude, codex, claude, codex)
    expect(final.transcript).toHaveLength(4);
    expect(final.transcript.map(t => t.speaker)).toEqual([
      'claude',
      'codex',
      'claude',
      'codex',
    ]);
    expect(final.transcript[0]!.content).toBe('proposal-from-claude');
    expect(final.transcript[1]!.content).toBe('critique-from-codex');
  });

  it('persists every turn to transcript.jsonl in order', async () => {
    const { claude, codex } = makeAgents();
    const dir = mkdtempSync(join(tmpdir(), 'bramble-run-'));
    const transcriptPath = join(dir, 'transcript.jsonl');

    await runDebate({
      agents: { claude, codex },
      prompt: 'x',
      rounds: 1,
      transcriptPath,
    });

    const lines = readFileSync(transcriptPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).speaker).toBe('claude');
    expect(JSON.parse(lines[1]!).speaker).toBe('codex');
  });

  it('invokes onToken for live streaming updates', async () => {
    const { claude, codex } = makeAgents();
    const dir = mkdtempSync(join(tmpdir(), 'bramble-run-'));
    const transcriptPath = join(dir, 'transcript.jsonl');
    const tokens: Array<{ speaker: string; text: string }> = [];

    await runDebate({
      agents: { claude, codex },
      prompt: 'x',
      rounds: 1,
      transcriptPath,
      onToken: (speaker, text) => tokens.push({ speaker, text }),
    });

    const claudeStream = tokens.filter(t => t.speaker === 'claude').map(t => t.text).join('');
    const codexStream = tokens.filter(t => t.speaker === 'codex').map(t => t.text).join('');
    expect(claudeStream).toBe('proposal-from-claude');
    expect(codexStream).toBe('critique-from-codex');
  });
});
