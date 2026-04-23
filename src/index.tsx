#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { join } from 'node:path';
import type { Agent } from './agents/agent.js';
import { FakeAgent } from './agents/fake.js';
import { ClaudeAgent } from './agents/claude.js';
import { CodexAgent } from './agents/codex.js';
import { App } from './ui/App.js';
import { generateSessionName } from './util/name.js';
import { readTranscript } from './docs/transcript.js';
import { rehydrateState } from './orchestrator/replay.js';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
let rounds = 3;
let real = false;
let claudeModel: string | undefined;
let codexModel: string | undefined;
let codexEffort: string | undefined;
let sessionName: string | undefined;
let resumeName: string | undefined;
let mode: 'auto' | 'collab' = 'auto';
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--rounds' && argv[i + 1]) {
    const n = Number(argv[i + 1]);
    if (Number.isInteger(n) && n >= 1) rounds = n;
    i++;
  } else if (a === '--real') {
    real = true;
  } else if (a === '--test') {
    // Fast-path: real agents pinned to cheap/fast models, low reasoning effort.
    real = true;
    claudeModel = claudeModel ?? 'claude-haiku-4-5';
    codexModel = codexModel ?? 'gpt-5.4-mini';
    codexEffort = codexEffort ?? 'low';
  } else if (a === '--claude-model' && argv[i + 1]) {
    claudeModel = argv[i + 1];
    i++;
  } else if (a === '--codex-model' && argv[i + 1]) {
    codexModel = argv[i + 1];
    i++;
  } else if (a === '--codex-effort' && argv[i + 1]) {
    codexEffort = argv[i + 1];
    i++;
  } else if (a === '--name' && argv[i + 1]) {
    sessionName = argv[i + 1];
    i++;
  } else if (a === '--resume' && argv[i + 1]) {
    resumeName = argv[i + 1];
    i++;
  } else if (a === '--collab') {
    mode = 'collab';
  } else if (a === '--auto') {
    mode = 'auto';
  } else {
    positional.push(a!);
  }
}

const prompt = positional.join(' ');
const cwd = process.cwd();
// --resume <name> takes over the session name; --name overrides otherwise.
const name = resumeName ?? sessionName ?? generateSessionName();

const transcriptPath = join(cwd, `transcript-${name}.jsonl`);
const resumedTurns = resumeName ? await readTranscript(transcriptPath) : [];
const resumedState =
  resumedTurns.length > 0 ? rehydrateState(resumedTurns) : undefined;
// If resuming, the original prompt lives in a sidecar file so we can rebuild
// the per-turn context. If not present, fall back to a short placeholder —
// the user can see the transcript but any new turns will have a weaker
// "goal" context. (We start writing prompt.txt below on fresh runs.)
const promptSidecarPath = join(cwd, `prompt-${name}.txt`);
let resumedPrompt: string | undefined;
if (resumeName) {
  try {
    const { readFile } = await import('node:fs/promises');
    resumedPrompt = (await readFile(promptSidecarPath, 'utf8')).trim();
  } catch {
    resumedPrompt = undefined;
  }
}

function binaryExists(cmd: string): boolean {
  const r = spawnSync('which', [cmd], { stdio: 'ignore' });
  return r.status === 0;
}

if (real) {
  const missing: string[] = [];
  if (!binaryExists('claude')) missing.push('claude');
  if (!binaryExists('codex')) missing.push('codex');
  if (missing.length > 0) {
    console.error(
      `bramble --real needs these CLIs on PATH: ${missing.join(', ')}`,
    );
    console.error(
      'install + auth them first:\n' +
        '  claude: https://claude.ai/code → claude /login\n' +
        '  codex:  https://openai.com/codex → codex login',
    );
    process.exit(1);
  }
}

let claude: Agent;
let codex: Agent;
if (real) {
  claude = new ClaudeAgent({ model: claudeModel });
  codex = new CodexAgent({ model: codexModel, reasoningEffort: codexEffort });
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
    prompt={prompt || resumedPrompt}
    sessionName={name}
    rounds={rounds}
    mode={mode}
    initialState={resumedState}
    promptSidecarPath={promptSidecarPath}
    transcriptPath={transcriptPath}
    specPath={join(cwd, `spec-${name}.md`)}
    debatePath={join(cwd, `debate-${name}.md`)}
    draftPath={join(cwd, `draft-${name}.md`)}
    draftsPath={join(cwd, `drafts-${name}.md`)}
    onQuit={() => process.exit(0)}
  />,
);

await waitUntilExit();
