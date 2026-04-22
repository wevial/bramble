#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { join } from 'node:path';
import { FakeAgent } from './agents/fake.js';
import { App } from './ui/App.js';

// Phase 2 entry: FakeAgents speak the structured patch protocol so the flow
// (proposal -> LGTM -> accepted draft in spec.md) is visible end-to-end.

const claude = new FakeAgent('claude');
const codex = new FakeAgent('codex');

claude.setResponse({
  commentary:
    'Proposing a minimal auth spec to start. Email+password, add OAuth later.',
  proposal: {
    body:
      '# Authentication\n\n' +
      '- Email + password signup\n' +
      '- bcrypt password hashing (cost 12)\n' +
      '- 30-day session tokens, rotated on each request\n' +
      '- Rate limit: 5 attempts / 15 min per IP',
  },
});

codex.setResponse({
  commentary:
    'Good starting point. I have a small OAuth quibble but the core draft is sound — LGTM.',
  verdict: 'LGTM',
});

claude.setTokenDelayMs(25);
codex.setTokenDelayMs(25);

const argv = process.argv.slice(2);
let rounds = 3;
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--rounds' && argv[i + 1]) {
    const n = Number(argv[i + 1]);
    if (Number.isInteger(n) && n >= 1) rounds = n;
    i++;
  } else {
    positional.push(argv[i]!);
  }
}
const prompt = positional.join(' ') || 'Design an authentication system';
const cwd = process.cwd();

const { waitUntilExit } = render(
  <App
    agents={{ claude, codex }}
    prompt={prompt}
    rounds={rounds}
    transcriptPath={join(cwd, 'transcript.jsonl')}
    specPath={join(cwd, 'spec.md')}
    debatePath={join(cwd, 'debate.md')}
    draftPath={join(cwd, 'draft.md')}
    onQuit={() => process.exit(0)}
  />,
);

await waitUntilExit();
