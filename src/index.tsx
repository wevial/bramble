#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { join } from 'node:path';
import type { Agent } from './agents/agent.js';
import { FakeAgent } from './agents/fake.js';
import { ClaudeAgent } from './agents/claude.js';
import { CodexAgent } from './agents/codex.js';
import { App } from './ui/App.js';

const argv = process.argv.slice(2);
let rounds = 3;
let real = false;
let claudeModel: string | undefined;
let codexModel: string | undefined;
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--rounds' && argv[i + 1]) {
    const n = Number(argv[i + 1]);
    if (Number.isInteger(n) && n >= 1) rounds = n;
    i++;
  } else if (a === '--real') {
    real = true;
  } else if (a === '--claude-model' && argv[i + 1]) {
    claudeModel = argv[i + 1];
    i++;
  } else if (a === '--codex-model' && argv[i + 1]) {
    codexModel = argv[i + 1];
    i++;
  } else {
    positional.push(a!);
  }
}

const prompt = positional.join(' ') || 'Design an authentication system';
const cwd = process.cwd();

let claude: Agent;
let codex: Agent;
if (real) {
  claude = new ClaudeAgent({ model: claudeModel });
  codex = new CodexAgent({ model: codexModel });
} else {
  const fClaude = new FakeAgent('claude');
  const fCodex = new FakeAgent('codex');
  fClaude.setResponse({
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
  fCodex.setResponse({
    commentary:
      'Good starting point. I have a small OAuth quibble but the core draft is sound — LGTM.',
    verdict: 'LGTM',
  });
  fClaude.setTokenDelayMs(25);
  fCodex.setTokenDelayMs(25);
  claude = fClaude;
  codex = fCodex;
}

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
