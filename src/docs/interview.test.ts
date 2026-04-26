import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeInterviewMd } from './interview.js';
import type { InterviewTurn, UserAnswer } from '../orchestrator/state.js';

let tmp: string;
let path: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bramble-interview-'));
  path = join(tmp, 'interview.md');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const T1 = '2026-04-25T00:00:00.000Z';
const T2 = '2026-04-25T00:01:00.000Z';
const T3 = '2026-04-25T00:02:00.000Z';
const T4 = '2026-04-25T00:03:00.000Z';

describe('writeInterviewMd', () => {
  it('writes an empty header for no turns', async () => {
    await writeInterviewMd(path, [], []);
    const out = readFileSync(path, 'utf8');
    expect(out).toContain('# Interview');
  });

  it('renders Q&A interleaved with user answers', async () => {
    const turns: InterviewTurn[] = [
      {
        speaker: 'claude',
        commentary: 'scoping users',
        question: 'who?',
        ready: false,
        timestamp: T1,
      },
      {
        speaker: 'codex',
        commentary: 'now compliance',
        question: 'soc 2?',
        ready: false,
        timestamp: T3,
      },
    ];
    const answers: UserAnswer[] = [
      { content: 'employees', timestamp: T2 },
      { content: 'yes', timestamp: T4 },
    ];
    await writeInterviewMd(path, turns, answers);
    const out = readFileSync(path, 'utf8');
    expect(out).toContain('## claude');
    expect(out).toContain('who?');
    expect(out).toContain('## user');
    expect(out).toContain('employees');
    expect(out).toContain('## codex');
    expect(out).toContain('soc 2?');
    expect(out).toContain('yes');
    // Order check: claude question before user reply before codex question.
    const idxClaude = out.indexOf('who?');
    const idxAns1 = out.indexOf('employees');
    const idxCodex = out.indexOf('soc 2?');
    expect(idxClaude).toBeLessThan(idxAns1);
    expect(idxAns1).toBeLessThan(idxCodex);
  });

  it('marks ready signals', async () => {
    const turns: InterviewTurn[] = [
      {
        speaker: 'claude',
        commentary: '',
        question: null,
        ready: true,
        timestamp: T1,
      },
    ];
    await writeInterviewMd(path, turns, []);
    const out = readFileSync(path, 'utf8');
    expect(out).toContain('signaled ready');
  });

  it('overwrites a previous body fully', async () => {
    await writeInterviewMd(
      path,
      [
        {
          speaker: 'claude',
          commentary: 'first',
          question: 'q1',
          ready: false,
          timestamp: T1,
        },
      ],
      [],
    );
    await writeInterviewMd(path, [], []);
    const out = readFileSync(path, 'utf8');
    expect(out).not.toContain('first');
    expect(out).not.toContain('q1');
  });
});
