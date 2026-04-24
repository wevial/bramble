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
import { listSessions, sessionPaths } from './sessions/list.js';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { helpText } from './help.js';
import { loadSavedSetup, defaultSetupPath } from './ui/setup-store.js';

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(helpText());
  process.exit(0);
}

let rounds = 3;
let real = false;
let claudeModel: string | undefined;
let claudeEffort: string | undefined;
let codexModel: string | undefined;
let codexEffort: string | undefined;
let sessionName: string | undefined;
let resumeName: string | undefined;
let cliMode: 'auto' | 'collab' | undefined;
let listMode = false;
let dirFlag: string | undefined;
let isolated = false;
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--list') {
    listMode = true;
  } else if (a === '--rounds' && argv[i + 1]) {
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
  } else if (a === '--claude-effort' && argv[i + 1]) {
    claudeEffort = argv[i + 1];
    i++;
  } else if (a === '--name' && argv[i + 1]) {
    sessionName = argv[i + 1];
    i++;
  } else if (a === '--resume' && argv[i + 1]) {
    resumeName = argv[i + 1];
    i++;
  } else if (a === '--collab') {
    cliMode = 'collab';
  } else if (a === '--auto') {
    cliMode = 'auto';
  } else if (a === '--dir' && argv[i + 1]) {
    dirFlag = argv[i + 1];
    i++;
  } else if (a === '--isolated') {
    isolated = true;
  } else {
    positional.push(a!);
  }
}

const prompt = positional.join(' ');
const cwd = process.cwd();
// Load the last setup-screen selection (mode + models) from disk so the
// setup screen opens with the user's most recent choices. CLI flags still
// win when provided.
const savedSetupPath = defaultSetupPath();
const savedSetup = loadSavedSetup(savedSetupPath) ?? {};
const mode: 'auto' | 'collab' = cliMode ?? savedSetup.mode ?? 'auto';
claudeModel = claudeModel ?? savedSetup.claudeModel ?? undefined;
claudeEffort = claudeEffort ?? savedSetup.claudeEffort ?? undefined;
codexModel = codexModel ?? savedSetup.codexModel ?? undefined;
codexEffort = codexEffort ?? savedSetup.codexEffort ?? undefined;
const storeRoot = dirFlag
  ? (dirFlag.startsWith('/') ? dirFlag : join(cwd, dirFlag))
  : join(cwd, '.bramble');

if (listMode) {
  const rows = await listSessions(storeRoot);
  if (rows.length === 0) {
    console.log('no bramble sessions in', storeRoot);
    process.exit(0);
  }
  const nameW = Math.max(4, ...rows.map(r => r.name.length));
  const header = `${pad('name', nameW)}  ${pad('turns', 5)}  ${pad('spec', 4)}  mtime                  goal`;
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of rows) {
    const when = r.mtime.toISOString().replace('T', ' ').slice(0, 19);
    const goal = r.goal.length > 60 ? r.goal.slice(0, 57) + '…' : r.goal;
    console.log(
      `${pad(r.name, nameW)}  ${pad(String(r.turns), 5)}  ${pad(r.accepted ? '✓' : '·', 4)}  ${when}    ${goal}`,
    );
  }
  console.log('\nresume with: bramble --resume <name>');
  process.exit(0);
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}


// --resume <name> takes over the session name; --name overrides otherwise.
const name = resumeName ?? sessionName ?? generateSessionName();
const paths = sessionPaths(storeRoot, name);
mkdirSync(paths.dir, { recursive: true });

const resumedTurns = resumeName ? await readTranscript(paths.transcriptPath) : [];
const resumedState =
  resumedTurns.length > 0 ? rehydrateState(resumedTurns) : undefined;
// If resuming, the original prompt lives in a sidecar file so we can rebuild
// the per-turn context. If not present, fall back to a short placeholder —
// the user can see the transcript but any new turns will have a weaker
// "goal" context.
let resumedPrompt: string | undefined;
if (resumeName) {
  try {
    const { readFile } = await import('node:fs/promises');
    resumedPrompt = (await readFile(paths.promptPath, 'utf8')).trim();
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
// Isolate agents by spawning them in throwaway tmpdirs so repo-local
// CLAUDE.md / AGENTS.md don't leak into the debate.
const isoCwd =
  real && isolated ? mkdtempSync(join(tmpdir(), 'bramble-iso-')) : undefined;
const buildRealAgents = real
  ? (config: {
      claudeModel: string | null;
      claudeEffort: string | null;
      codexModel: string | null;
      codexEffort: string | null;
    }) => ({
      claude: new ClaudeAgent({
        model: config.claudeModel ?? undefined,
        reasoningEffort: config.claudeEffort ?? undefined,
        cwd: isoCwd,
      }),
      codex: new CodexAgent({
        model: config.codexModel ?? undefined,
        reasoningEffort: config.codexEffort ?? undefined,
        cwd: isoCwd,
      }),
    })
  : undefined;
if (real) {
  claude = new ClaudeAgent({
    model: claudeModel,
    reasoningEffort: claudeEffort,
    cwd: isoCwd,
  });
  codex = new CodexAgent({
    model: codexModel,
    reasoningEffort: codexEffort,
    cwd: isoCwd,
  });
} else {
  const fClaude = new FakeAgent('claude');
  const fCodex = new FakeAgent('codex');
  fClaude.setResponses([
    {
      commentary:
        'Proposing a minimal auth spec to start. Email+password core, OAuth deferred.',
      proposal: {
        body:
          '# Authentication\n\n' +
          '## Signup\n\n' +
          '- Email + password\n' +
          '- **bcrypt** password hashing (cost 12)\n' +
          '- 30-day session tokens, rotated on each request\n\n' +
          '## Example request\n\n' +
          '```json\n' +
          '{\n' +
          '  "email": "a@b.com",\n' +
          '  "password": "hunter2"\n' +
          '}\n' +
          '```\n\n' +
          '## Rate limits\n\n' +
          '- 5 attempts / 15 min per IP',
      },
    },
    {
      commentary:
        'Fair points on rotation and 2FA. Revising to pin token rotation and add a TOTP hook.',
      proposal: {
        body:
          '# Authentication\n\n' +
          '## Signup\n\n' +
          '- Email + password\n' +
          '- **bcrypt** password hashing (cost 12)\n' +
          '- Session tokens rotate on privilege change; sliding 30-day idle expiry\n' +
          '- Optional **TOTP** second factor (RFC 6238, 30s window)\n\n' +
          '## Example request\n\n' +
          '```json\n' +
          '{\n' +
          '  "email": "a@b.com",\n' +
          '  "password": "hunter2",\n' +
          '  "totp": "123456"\n' +
          '}\n' +
          '```\n\n' +
          '## Rate limits\n\n' +
          '- 5 attempts / 15 min per IP\n' +
          '- Lockout escalates to 1h after 3 consecutive trip-ups',
      },
    },
    {
      commentary:
        'Codex is right that the revised draft is tighter. LGTM.',
      verdict: 'LGTM',
    },
  ]);
  fCodex.setResponses([
    {
      commentary:
        'Solid skeleton. Two concerns: *rotate on every request* is chatty, and no 2FA path. Countering.',
      verdict: 'counter',
    },
    {
      commentary:
        'The revised draft addresses both points cleanly. Happy to accept.',
      verdict: 'LGTM',
    },
  ]);
  fClaude.setTokenDelayMs(15);
  fCodex.setTokenDelayMs(15);
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
    promptSidecarPath={paths.promptPath}
    transcriptPath={paths.transcriptPath}
    specPath={paths.specPath}
    debatePath={paths.debatePath}
    draftPath={paths.draftPath}
    draftsPath={paths.draftsPath}
    exportPath={paths.exportPath}
    buildAgents={buildRealAgents}
    initialModelConfig={{
      claudeModel: claudeModel ?? null,
      claudeEffort: claudeEffort ?? null,
      codexModel: codexModel ?? null,
      codexEffort: codexEffort ?? null,
    }}
    setupStorePath={savedSetupPath}
    onQuit={() => process.exit(0)}
  />,
);

await waitUntilExit();
