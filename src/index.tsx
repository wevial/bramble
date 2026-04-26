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

let maxRounds = 8;
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
    if (Number.isInteger(n) && n >= 1) maxRounds = n;
    i++;
  } else if (a === '--real') {
    real = true;
  } else if (a === '--test') {
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

const name = resumeName ?? sessionName ?? generateSessionName();
const paths = sessionPaths(storeRoot, name);
mkdirSync(paths.dir, { recursive: true });

const resumedEntries = resumeName ? await readTranscript(paths.transcriptPath) : [];
const resumedState =
  resumedEntries.length > 0 ? rehydrateState(resumedEntries) : undefined;
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
    process.exit(1);
  }
}

let claude: Agent;
let codex: Agent;
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
      kind: 'interview',
      commentary: 'Want to scope users first.',
      question: 'Internal users only, or external signups too?',
    },
    {
      kind: 'interview',
      commentary: 'Got it.',
      ready: true,
    },
    {
      kind: 'debate',
      commentary: 'Seeding the spec with a goals + auth skeleton.',
      edits: [
        {
          find: '',
          replace:
            '# Spec\n\n## Goals\nA simple authentication system.\n\n## Auth\n- Email + password\n- bcrypt hashing\n',
        },
      ],
    },
    {
      kind: 'debate',
      commentary: 'Tightened the goals line per codex.',
      edits: [
        { find: 'A simple authentication system.', replace: 'A minimal email + password auth system for internal tools.' },
      ],
      verdict: 'lgtm',
    },
  ]);
  fCodex.setResponses([
    {
      kind: 'interview',
      commentary: 'Need to know the deployment target.',
      question: 'Web app? Mobile? CLI?',
    },
    {
      kind: 'interview',
      commentary: 'I have enough.',
      ready: true,
    },
    {
      kind: 'debate',
      commentary: '"Goals" is too vague — recommend tightening to internal tools.',
      edits: [],
    },
    {
      kind: 'debate',
      commentary: 'Looks good.',
      edits: [],
      verdict: 'lgtm',
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
    config={{ maxRounds }}
    mode={mode}
    initialState={resumedState ?? undefined}
    promptSidecarPath={paths.promptPath}
    transcriptPath={paths.transcriptPath}
    specPath={paths.specPath}
    debatePath={paths.debatePath}
    interviewPath={paths.interviewPath}
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
