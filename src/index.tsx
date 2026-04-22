#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { join } from 'node:path';
import { FakeAgent } from './agents/fake.js';
import { App } from './ui/App.js';

// Phase 0 entry: uses FakeAgents so the walking skeleton runs without API keys.
// Real Claude/Codex wiring lands in the next task.

const claude = new FakeAgent('claude');
const codex = new FakeAgent('codex');
claude.setResponse(
  'I propose we start with a simple email+password auth scheme and add OAuth later.',
);
codex.setResponse(
  'Counter: we should support OAuth from day one. Email-only locks out social login users.',
);
claude.setTokenDelayMs(12);
codex.setTokenDelayMs(12);

const prompt = process.argv.slice(2).join(' ') || 'Design an authentication system';
const transcriptPath = join(process.cwd(), 'transcript.jsonl');

render(
  <App
    agents={{ claude, codex }}
    prompt={prompt}
    rounds={1}
    transcriptPath={transcriptPath}
    onDone={() => {
      // Phase 0: auto-exit once the debate finishes.
      setTimeout(() => process.exit(0), 100);
    }}
  />,
);
