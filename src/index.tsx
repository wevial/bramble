#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { join } from 'node:path';
import { FakeAgent } from './agents/fake.js';
import { App } from './ui/App.js';

// Phase 1 entry: uses FakeAgents so the walking skeleton runs without API keys.
// Real Claude/Codex wiring lands in Task #4.

const claude = new FakeAgent('claude');
const codex = new FakeAgent('codex');
claude.setResponse(
  'I propose we start with a simple email+password auth scheme and add OAuth later. It ships in a week.',
);
codex.setResponse(
  'Counter: we should support OAuth from day one. Email-only locks out social users and forces a rewrite later.',
);
claude.setTokenDelayMs(18);
codex.setTokenDelayMs(18);

const prompt = process.argv.slice(2).join(' ') || 'Design an authentication system';
const cwd = process.cwd();

const { waitUntilExit } = render(
  <App
    agents={{ claude, codex }}
    prompt={prompt}
    rounds={1}
    transcriptPath={join(cwd, 'transcript.jsonl')}
    specPath={join(cwd, 'spec.md')}
    debatePath={join(cwd, 'debate.md')}
    onQuit={() => process.exit(0)}
  />,
);

await waitUntilExit();
