#!/usr/bin/env bun
import React from 'react';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { basename, join } from 'node:path';
import type { Agent } from './agents/agent.js';
import { FakeAgent } from './agents/fake.js';
import { ClaudeAgent } from './agents/claude.js';
import { CodexAgent } from './agents/codex.js';
import { App } from './ui/App.js';
import { generateSessionName } from './util/name.js';
import { readTranscript } from './docs/transcript.js';
import { rehydrateState } from './orchestrator/replay.js';
import {
  INTERVIEW_INTENSITIES,
  isInterviewIntensity,
  type InterviewIntensity,
  type State,
} from './orchestrator/state.js';
import { listSessions, sessionPaths, detectSessionFormat } from './sessions/list.js';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { helpText } from './help.js';
import { type OutputFormat, isOutputFormat, convertSpec } from './docs/format.js';
import { loadSavedSetup, defaultSetupPath } from './ui/setup-store.js';
import { CHEAP_CLAUDE_MODEL, CHEAP_CODEX_MODEL } from './ui/models.js';
import {
  CLAUDE_PERSONA,
  CODEX_PERSONA,
  SPECIALIST_PERSONAS,
  type Persona,
} from './personas/personas.js';
import { systemInstructions } from './prompts/system.js';
import {
  LLMModerator,
  RoundRobinModerator,
  type Moderator,
  type ModeratorPick,
} from './moderator/moderator.js';

const argv = process.argv.slice(2);

// `bramble mcp [flags]` — headless MCP server over stdio. Handled before the
// TUI/flag machinery so it never boots OpenTUI (mirrors the autopilot early
// path). stdout belongs to JSON-RPC; all logging goes to stderr.
if (argv[0] === 'mcp') {
  const rest = argv.slice(1);
  let mcpMock = false;
  let mcpDir: string | undefined;
  let mcpFormat: OutputFormat = 'md';
  let mcpClaudeModel: string | undefined;
  let mcpClaudeEffort: string | undefined;
  let mcpCodexModel: string | undefined;
  let mcpCodexEffort: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--mock') mcpMock = true;
    else if (a === '--dir' && rest[i + 1]) { mcpDir = rest[++i]; }
    else if (a === '--format' && rest[i + 1]) {
      const f = rest[++i]!;
      if (isOutputFormat(f)) mcpFormat = f;
      else { console.error(`unknown --format value: ${f}  (expected md, xml, json, or html)`); process.exit(1); }
    } else if (a === '--claude-model' && rest[i + 1]) { mcpClaudeModel = rest[++i]; }
    else if (a === '--claude-effort' && rest[i + 1]) { mcpClaudeEffort = rest[++i]; }
    else if (a === '--codex-model' && rest[i + 1]) { mcpCodexModel = rest[++i]; }
    else if (a === '--codex-effort' && rest[i + 1]) { mcpCodexEffort = rest[++i]; }
  }
  const mcpCwd = process.cwd();
  const mcpRoot = mcpDir
    ? (mcpDir.startsWith('/') ? mcpDir : join(mcpCwd, mcpDir))
    : join(mcpCwd, '.bramble');
  const { runMcpServer } = await import('./mcp/server.js');
  await runMcpServer({
    root: mcpRoot,
    cwd: mcpCwd,
    mock: mcpMock,
    format: mcpFormat,
    claudeModel: mcpClaudeModel,
    claudeEffort: mcpClaudeEffort,
    codexModel: mcpCodexModel,
    codexEffort: mcpCodexEffort,
  });
  process.exit(0);
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(helpText());
  process.exit(0);
}

if (argv.includes('--version') || argv.includes('-v')) {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  console.log(pkg.version);
  process.exit(0);
}

let maxRounds = 8;
let real = true;
let claudeModel: string | undefined;
let claudeEffort: string | undefined;
let codexModel: string | undefined;
let codexEffort: string | undefined;
let codexTransport: 'exec' | 'app-server' | undefined;
let sessionName: string | undefined;
let resumeName: string | undefined;
let cliMode: 'auto' | 'collab' | undefined;
let listMode = false;
let dirFlag: string | undefined;
let isolated = false;
let outputFormat: OutputFormat = 'md';
let autopilot = false;
let autopilotAnswers = 3;
let caucusFlag: boolean | undefined;
let moderatorFlag: boolean | undefined;
let interviewFlag: InterviewIntensity | undefined;
let turnTimeoutMs: number | undefined;
const cliSpecialists: string[] = [];
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--list') {
    listMode = true;
  } else if (a === '--rounds' && argv[i + 1]) {
    const n = Number(argv[i + 1]);
    if (Number.isInteger(n) && n >= 1) maxRounds = n;
    i++;
  } else if (a === '--mock') {
    real = false;
  } else if (a === '--real') {
    // Real is the default since v0.2; kept as a no-op for old scripts.
    real = true;
  } else if (a === '--caucus') {
    caucusFlag = true;
  } else if (a === '--no-caucus') {
    caucusFlag = false;
  } else if (a === '--moderator') {
    moderatorFlag = true;
  } else if (a === '--no-moderator') {
    moderatorFlag = false;
  } else if (a === '--interview' && argv[i + 1]) {
    const v = argv[i + 1]!;
    if (isInterviewIntensity(v)) {
      interviewFlag = v;
    } else {
      console.error(
        `unknown --interview value: ${v}  (expected ${INTERVIEW_INTENSITIES.join(', ')})`,
      );
      process.exit(1);
    }
    i++;
  } else if (a === '--test') {
    real = true;
    claudeModel = claudeModel ?? CHEAP_CLAUDE_MODEL;
    claudeEffort = claudeEffort ?? 'low';
    codexModel = codexModel ?? CHEAP_CODEX_MODEL;
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
  } else if (a === '--codex-transport' && argv[i + 1]) {
    const t = argv[i + 1]!;
    if (t === 'exec' || t === 'app-server') {
      codexTransport = t;
    } else {
      console.error(`unknown --codex-transport value: ${t}  (expected exec or app-server)`);
      process.exit(1);
    }
    i++;
  } else if (a === '--claude-effort' && argv[i + 1]) {
    const e = argv[i + 1]!;
    if (['low', 'medium', 'high', 'xhigh', 'max'].includes(e)) {
      claudeEffort = e;
    } else {
      console.error(
        `unknown --claude-effort value: ${e}  (expected low, medium, high, xhigh, or max)`,
      );
      process.exit(1);
    }
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
  } else if (a === '--format' && argv[i + 1]) {
    const f = argv[i + 1]!;
    if (isOutputFormat(f)) {
      outputFormat = f;
    } else {
      console.error(`unknown --format value: ${f}  (expected md, xml, json, or html)`);
      process.exit(1);
    }
    i++;
  } else if (a === '--specialist' && argv[i + 1]) {
    // Repeatable, and accepts comma-separated lists: --specialist security,perf
    const validIds = SPECIALIST_PERSONAS.map(p => p.id);
    for (const id of argv[i + 1]!.split(',').map(s => s.trim()).filter(Boolean)) {
      if (!validIds.includes(id)) {
        console.error(
          `unknown --specialist value: ${id}  (expected one of ${validIds.join(', ')})`,
        );
        process.exit(1);
      }
      if (!cliSpecialists.includes(id)) cliSpecialists.push(id);
    }
    i++;
  } else if (a === '--turn-timeout' && argv[i + 1]) {
    const n = Number(argv[i + 1]);
    if (Number.isInteger(n) && n >= 0) {
      turnTimeoutMs = n * 1000;
    } else {
      console.error(
        `unknown --turn-timeout value: ${argv[i + 1]}  (expected seconds as an integer >= 0; 0 disables)`,
      );
      process.exit(1);
    }
    i++;
  } else if (a === '--autopilot') {
    autopilot = true;
  } else if (a === '--autopilot-answers' && argv[i + 1]) {
    const n = Number(argv[i + 1]);
    if (Number.isInteger(n) && n >= 0) {
      autopilotAnswers = n;
    } else {
      console.error(
        `unknown --autopilot-answers value: ${argv[i + 1]}  (expected an integer >= 0)`,
      );
      process.exit(1);
    }
    i++;
  } else {
    positional.push(a!);
  }
}

const prompt = positional.join(' ');
const cwd = process.cwd();
const savedSetupPath = defaultSetupPath();
const savedSetup = loadSavedSetup(savedSetupPath) ?? {};
const mode: 'auto' | 'collab' = cliMode ?? savedSetup.mode ?? 'auto';
// Same CLI-overrides-saved precedence as models/mode above.
const effectiveSpecialists: string[] =
  cliSpecialists.length > 0 ? cliSpecialists : savedSetup.specialists ?? [];
const effectiveCaucus: boolean = caucusFlag ?? savedSetup.caucus ?? false;
const effectiveModerator: boolean =
  moderatorFlag ?? savedSetup.moderator ?? false;
const effectiveInterview: InterviewIntensity =
  interviewFlag ?? savedSetup.interview ?? 'medium';
if (resumeName && cliSpecialists.length > 0) {
  console.error(
    '--specialist cannot be combined with --resume: personas are restored from the session transcript',
  );
  process.exit(1);
}
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
  const header = `${pad('name', nameW)}  ${pad('turns', 5)}  ${pad('spec', 4)}  ${pad('created', 10)}  ${pad('updated', 19)}  goal`;
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of rows) {
    const created = r.created ? r.created.toISOString().slice(0, 10) : '—';
    const updated = r.updated.toISOString().replace('T', ' ').slice(0, 19);
    const goal = r.goal.length > 60 ? r.goal.slice(0, 57) + '…' : r.goal;
    console.log(
      `${pad(r.name, nameW)}  ${pad(String(r.turns), 5)}  ${pad(r.accepted ? '✓' : '·', 4)}  ${pad(created, 10)}  ${updated}  ${goal}`,
    );
  }
  console.log('\nresume with: bramble --resume <name>');
  process.exit(0);
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

async function printSessionSummary(
  p: ReturnType<typeof sessionPaths>,
  sessionLabel: string,
): Promise<void> {
  const { stat } = await import('node:fs/promises');
  let finalPhase = 'unknown';
  let endReason: string | null = null;
  let interviewTurns = 0;
  let debateTurns = 0;
  let rounds = 0;
  let specChars = 0;
  try {
    const entries = await readTranscript(p.transcriptPath);
    if (entries.length > 0) {
      const s = rehydrateState(entries);
      if (s) {
        finalPhase = s.phase;
        endReason = s.endReason ?? null;
        interviewTurns = s.interview.length;
        debateTurns = s.debate.length;
        rounds = s.round;
        specChars = s.spec.length;
      }
    }
  } catch {
    /* fall through with defaults */
  }

  const files: { label: string; path: string }[] = [
    { label: basename(p.specPath), path: p.specPath },
    { label: 'checkpoint.md', path: p.checkpointPath },
    { label: 'interview.md', path: p.interviewPath },
    { label: 'debate.md', path: p.debatePath },
    { label: 'transcript.jsonl', path: p.transcriptPath },
    { label: basename(p.promptPath), path: p.promptPath },
  ];
  const sized: { label: string; path: string; size: number | null }[] = [];
  for (const f of files) {
    try {
      const st = await stat(f.path);
      sized.push({ ...f, size: st.size });
    } catch {
      sized.push({ ...f, size: null });
    }
  }

  console.log(`\n✦ bramble — session "${sessionLabel}"`);
  if (finalPhase === 'done') {
    console.log(`  ended: done${endReason ? ` (${endReason})` : ''}`);
  } else if (finalPhase === 'unknown') {
    console.log(`  ended: no progress recorded`);
  } else {
    console.log(`  ended early in phase: ${finalPhase}`);
  }
  console.log(
    `  interview: ${interviewTurns} turn${interviewTurns === 1 ? '' : 's'}` +
      ` · debate: ${debateTurns} turn${debateTurns === 1 ? '' : 's'} across ${rounds} round${rounds === 1 ? '' : 's'}` +
      ` · spec: ${specChars}c`,
  );
  console.log('\nFiles:');
  const labelW = Math.max(...sized.map(f => f.label.length));
  for (const f of sized) {
    const sizeStr = f.size === null ? '   —' : formatSize(f.size);
    console.log(`  ${pad(f.label, labelW)}  ${sizeStr.padStart(7)}  ${f.path}`);
  }
  if (finalPhase !== 'done') {
    console.log(`\nResume with: bramble --resume ${sessionLabel}`);
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

const name = resumeName ?? sessionName ?? generateSessionName();
// When resuming, auto-detect the format used by the original session so
// the spec file extension stays consistent unless the user explicitly
// overrides it with --format.
const userExplicitFormat = argv.includes('--format');
if (resumeName && !userExplicitFormat) {
  const detected = await detectSessionFormat(join(storeRoot, resumeName));
  if (detected) outputFormat = detected;
}
const paths = sessionPaths(storeRoot, name, outputFormat);
// Only create the session dir up front when resuming — otherwise defer it
// until the user actually starts the session from the setup screen so a
// quick launch-and-quit doesn't litter the store with empty dirs.
if (resumeName) mkdirSync(paths.dir, { recursive: true });

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
      `bramble needs these CLIs on PATH: ${missing.join(', ')} (or pass --mock to run with fake agents)`,
    );
    process.exit(1);
  }
}

let claude: Agent;
let codex: Agent;
const isoCwd =
  real && isolated ? mkdtempSync(join(tmpdir(), 'bramble-iso-')) : undefined;
// Primaries get read-only repo access (Read/Grep/Glob for claude, sandbox
// 'read-only' for codex) when the session is NOT isolated — i.e. when bramble
// is running inside the user's actual repo. Specialists stay tool-less for
// now: they're advisory and don't need to spelunk files. Isolated mode keeps
// the legacy tool-less behavior since the cwd is an empty tmp dir anyway.
const repoToolsEnabled = real && !isolated;
const buildRealAgents = real
  ? (
      config: {
        claudeModel: string | null;
        claudeEffort: string | null;
        codexModel: string | null;
        codexEffort: string | null;
      },
      personas: Persona[],
    ): Record<string, Agent> => {
      const result: Record<string, Agent> = {};
      for (const persona of personas) {
        const others = personas.filter(p => p.id !== persona.id);
        const sys = systemInstructions(persona, others);
        const grantTools = repoToolsEnabled && persona.scope === 'primary';
        if (persona.transport === 'claude') {
          result[persona.id] = new ClaudeAgent({
            model: config.claudeModel ?? undefined,
            reasoningEffort: config.claudeEffort ?? undefined,
            cwd: isoCwd,
            systemInstructions: sys,
            allowedTools: grantTools ? ['Read', 'Grep', 'Glob'] : undefined,
            idleTimeoutMs: turnTimeoutMs,
          });
        } else {
          result[persona.id] = new CodexAgent({
            model: config.codexModel ?? undefined,
            reasoningEffort: config.codexEffort ?? undefined,
            cwd: isoCwd,
            systemInstructions: sys,
            sandbox: grantTools ? 'read-only' : undefined,
            transportKind: codexTransport,
            idleTimeoutMs: turnTimeoutMs,
          });
        }
      }
      return result;
    }
  : undefined;
if (real) {
  claude = new ClaudeAgent({
    model: claudeModel,
    reasoningEffort: claudeEffort,
    cwd: isoCwd,
    idleTimeoutMs: turnTimeoutMs,
  });
  codex = new CodexAgent({
    model: codexModel,
    reasoningEffort: codexEffort,
    cwd: isoCwd,
    transportKind: codexTransport,
    idleTimeoutMs: turnTimeoutMs,
  });
} else {
  const fClaude = new FakeAgent('claude');
  const fCodex = new FakeAgent('codex');
  // Demo fixtures for an "auth system" goal — interview goes ~4 questions
  // per agent before signaling ready, then a multi-round debate evolves the
  // spec rather than rubber-stamping. Real runs (the default) use live agents.
  fClaude.setResponses([
    {
      kind: 'interview',
      commentary: 'Scoping users before mechanics.',
      question:
        'Who will use this? Internal employees only, public signups, or both with role-based access?',
    },
    {
      kind: 'interview',
      commentary: "Now the threat model — that shapes the auth surface.",
      question:
        'What are the highest-risk attack scenarios you want to defend against (phishing, credential stuffing, session hijacking, insider threat)?',
    },
    {
      kind: 'interview',
      commentary: "Need to understand operational constraints.",
      question:
        'Is there an existing identity provider (Okta/Google Workspace/etc.) you want to integrate with, or should this be standalone?',
    },
    {
      kind: 'interview',
      commentary: 'Last one — recovery is usually where these systems break.',
      question:
        'How do users recover access if they lose their credentials? Email reset, admin-issued reset, recovery codes?',
    },
    {
      kind: 'interview',
      commentary: 'I have enough to start drafting.',
      ready: true,
    },
    {
      kind: 'debate',
      commentary:
        'Seeding the spec with goals, threat model, auth flow, and recovery — based on the interview answers.',
      edits: [
        {
          find: '',
          replace:
            '# Authentication Spec\n\n' +
            '## Goals\nA minimal email + password auth system for internal tools, integrated with the existing identity provider for SSO.\n\n' +
            '## Threat Model\n- Credential stuffing: rate-limit + lockouts.\n- Session hijacking: short-lived tokens, rotated on privilege change.\n- Phishing: 2FA hooks (TOTP).\n\n' +
            '## Auth Flow\n- Email + password fallback (bcrypt cost 12).\n- SSO via OIDC as primary path.\n- Optional TOTP second factor.\n\n' +
            '## Recovery\n- Admin-issued reset link, time-boxed (15 min).\n- Recovery codes generated at signup.\n',
        },
      ],
    },
    {
      kind: 'debate',
      commentary:
        "Codex is right that 'short-lived' is hand-wavy. Pinning concrete numbers and adding a token-rotation clause.",
      edits: [
        {
          find: '- Session hijacking: short-lived tokens, rotated on privilege change.',
          replace:
            '- Session hijacking: 30-min idle expiry, sliding refresh up to 24h, hard rotation on privilege change.',
        },
      ],
    },
    {
      kind: 'debate',
      commentary: 'Tightening "Goals" to make the SSO-primary stance explicit.',
      edits: [
        {
          find: 'integrated with the existing identity provider for SSO.',
          replace:
            'with SSO (OIDC) as the primary path and email+password as a fallback only when SSO is unavailable.',
        },
      ],
    },
    {
      kind: 'debate',
      commentary: 'I think this is solid now. LGTM.',
      edits: [],
      verdict: 'lgtm',
    },
  ]);
  fCodex.setResponses([
    {
      kind: 'interview',
      commentary: 'Echoing what claude is after — also need delivery surface.',
      question:
        'What clients consume this — web app, mobile, CLI, server-to-server, or some mix?',
    },
    {
      kind: 'interview',
      commentary: 'Compliance shapes a lot of the audit + retention surface.',
      question:
        'Are there compliance constraints (SOC 2, HIPAA, GDPR) that force specific audit logging or data-retention rules?',
    },
    {
      kind: 'interview',
      commentary: 'And the org context — that changes whether to over-invest in this.',
      question:
        'What scale are we designing for now (users, peak login rate), and is there a known 12-month growth target?',
    },
    {
      kind: 'interview',
      commentary: 'I have what I need.',
      ready: true,
    },
    {
      kind: 'debate',
      commentary:
        '"Short-lived tokens" is too vague — propose tightening to concrete time windows.',
      edits: [],
    },
    {
      kind: 'debate',
      commentary:
        "Good revision on session hijacking. Adding a non-functional rate-limit number to back the credential-stuffing line.",
      edits: [
        {
          find: '- Credential stuffing: rate-limit + lockouts.',
          replace:
            '- Credential stuffing: 5 attempts / 15 min per IP, exponential lockouts after 3 trips.',
        },
      ],
    },
    {
      kind: 'debate',
      commentary: 'Goals reads cleanly now. Happy with this.',
      edits: [],
      verdict: 'lgtm',
    },
    {
      kind: 'debate',
      commentary: 'Holding lgtm.',
      edits: [],
      verdict: 'lgtm',
    },
  ]);
  fClaude.setTokenDelayMs(8);
  fCodex.setTokenDelayMs(8);
  claude = fClaude;
  codex = fCodex;
}

/**
 * Build a FakeAgent-shaped backing for an arbitrary specialist persona,
 * for fake mode. Phase-aware: returns interview-shaped JSON during the
 * interview phase (one role-flavored question, then ready forever) and
 * debate-shaped JSON during debate (one continue, then lgtm forever).
 * Without phase awareness, a fixed response cycle would emit
 * debate-shaped JSON during interview once the cycle wrapped, which the
 * interview parser can't handle.
 */
function buildFakeSpecialist(persona: Persona): Agent {
  let interviewCalls = 0;
  let debateCalls = 0;
  const TOKEN_DELAY = 8;
  return {
    name: persona.transport,
    async *stream(ctx, signal) {
      let raw: string;
      let displayText: string;
      if (ctx.phase === 'interview') {
        if (interviewCalls === 0) {
          const question =
            (persona.systemPrompt.split('.')[0] ?? `What's a key concern for the ${persona.label} role`)
              .replace(/^You are[^.]*\.\s*/, '')
              .trim() + '?';
          const commentary = `${persona.label} angle: one question to frame the role.`;
          displayText = commentary;
          raw = JSON.stringify({ commentary, question, ready: false });
        } else {
          const commentary = `${persona.label}: have what I need from this role. Signaling ready.`;
          displayText = commentary;
          raw = JSON.stringify({ commentary, question: null, ready: true });
        }
        interviewCalls += 1;
      } else {
        // debate phase
        const verdict: 'continue' | 'lgtm' = debateCalls === 0 ? 'continue' : 'lgtm';
        const commentary =
          verdict === 'continue'
            ? `${persona.label}: reading the spec — no edits this round, will evaluate after the primaries land theirs.`
            : `${persona.label}: spec covers my role's concerns adequately. lgtm.`;
        displayText = commentary;
        raw = JSON.stringify({ commentary, edits: [], verdict });
        debateCalls += 1;
      }
      for (const ch of displayText) {
        if (signal.aborted) return;
        await new Promise<void>(resolve => {
          const t = setTimeout(resolve, TOKEN_DELAY);
          signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
        });
        if (signal.aborted) return;
        yield { text: ch };
      }
      return { raw };
    },
  };
}

/**
 * In fake mode: build the per-persona Agent map by reusing the canned
 * fClaude/fCodex for primaries and constructing a generic FakeAgent per
 * specialist. Mirrors the shape of buildRealAgents so App can call it the
 * same way.
 */
const buildFakeAgents = real
  ? undefined
  : (
      _config: unknown,
      personas: Persona[],
    ): Record<string, Agent> => {
      const result: Record<string, Agent> = {};
      for (const persona of personas) {
        if (persona.id === 'claude') result[persona.id] = claude;
        else if (persona.id === 'codex') result[persona.id] = codex;
        else result[persona.id] = buildFakeSpecialist(persona);
      }
      return result;
    };

/**
 * In real mode the moderator is a Codex subprocess pinned to the cheap
 * model — fast, since we're only asking "who speaks next?" In fake
 * mode it's a round-robin wrapped with a canned reason so the UI surface
 * still demos the moderator attribution row.
 */
function buildModerator(personas: Persona[]): Moderator {
  if (real) {
    const agent = new CodexAgent({
      model: CHEAP_CODEX_MODEL,
      reasoningEffort: 'low',
      cwd: isoCwd,
      systemInstructions:
        'You are a debate moderator. Output one JSON object per request, nothing else.',
      transportKind: codexTransport,
      idleTimeoutMs: turnTimeoutMs,
    });
    return new LLMModerator({ agent, personas });
  }
  const rr = new RoundRobinModerator();
  return {
    async pick(state, signal): Promise<ModeratorPick> {
      const pick = await rr.pick(state, signal);
      const label =
        personas.find(p => p.id === pick.next)?.label ?? pick.next;
      return {
        next: pick.next,
        reason: `round-robin (fake mode) — ${label}'s turn in the rotation`,
      };
    },
  };
}

/**
 * Simulated user: cheap Codex in real mode (runs in the trusted repo cwd,
 * NOT the isolated tmpdir, so it doesn't trip codex's trusted-dir check);
 * a canned responder in fake mode so no CLI is needed. Construction is lazy
 * (no process until first stream) — used by --autopilot and by the TUI's
 * 'auto' interview intensity.
 */
function buildSimulatedUser(): Agent {
  return real
    ? new CodexAgent({
        model: CHEAP_CODEX_MODEL,
        reasoningEffort: 'low',
        systemInstructions:
          'You role-play a product owner answering a builder\'s clarifying ' +
          'questions. Reply in 1–2 concrete sentences with sensible defaults. ' +
          'Never ask questions back. Plain prose only.',
        transportKind: codexTransport,
        idleTimeoutMs: turnTimeoutMs,
      })
    : {
        name: 'codex' as const,
        // eslint-disable-next-line require-yield
        async *stream() {
          return { raw: 'Use sensible defaults and proceed.' };
        },
      };
}

// Autopilot: run headless (no TUI). A cheap simulated user answers the
// interview so a full interview→criteria→debate run completes with zero
// prompts — for smoke-testing the loop and watching delta prompts engage.
if (autopilot) {
  if (resumeName) {
    console.error('--autopilot cannot be combined with --resume');
    process.exit(1);
  }
  mkdirSync(paths.dir, { recursive: true });
  const personas = [
    CLAUDE_PERSONA,
    CODEX_PERSONA,
    ...SPECIALIST_PERSONAS.filter(p => effectiveSpecialists.includes(p.id)),
  ];
  const modelConfig = {
    claudeModel: claudeModel ?? null,
    claudeEffort: claudeEffort ?? null,
    codexModel: codexModel ?? null,
    codexEffort: codexEffort ?? null,
  };
  const buildAgents = real ? buildRealAgents! : buildFakeAgents!;
  const agents = buildAgents(modelConfig, personas);
  // Same opt-in as the TUI: without --moderator the runner's deterministic
  // rotation picks speakers and we skip the per-turn moderator LLM call.
  const moderator = effectiveModerator ? buildModerator(personas) : undefined;
  const simulatedUser: Agent = buildSimulatedUser();

  console.log(`✦ bramble autopilot — "${prompt}"`);
  console.log(`  agents: ${real ? `claude=${claudeModel ?? 'default'}, codex=${codexModel ?? 'default'}` : 'fakes'} · answers: ${autopilotAnswers} · rounds: ${maxRounds}`);

  const { runAutopilot } = await import('./orchestrator/autopilot.js');
  const final = await runAutopilot({
    agents,
    personas,
    moderator,
    prompt,
    transcriptPath: paths.transcriptPath,
    simulatedUser,
    maxAnswers: autopilotAnswers,
    maxRounds,
    caucusStep: effectiveCaucus,
    models: real ? modelConfig : undefined,
    interviewIntensity: effectiveInterview,
  });

  const { writeFile } = await import('node:fs/promises');
  // paths.specPath already carries the right extension for outputFormat;
  // convert the markdown spec to match (mirrors the TUI write path).
  await writeFile(
    paths.specPath,
    convertSpec(final.spec, outputFormat),
    'utf8',
  ).catch(() => {});
  const { writeCheckpoint } = await import('./docs/checkpoint.js');
  await writeCheckpoint(paths.checkpointPath, final, personas).catch(() => {});
  console.log(`\n=== FINAL (phase: ${final.phase}${final.endReason ? `, ${final.endReason}` : ''}) ===`);
  console.log(`spec: ${final.spec.length} chars → ${paths.specPath}`);
  console.log(`checkpoint → ${paths.checkpointPath}`);
  console.log('\n' + (final.spec || '(empty spec)'));
  await printSessionSummary(paths, name);
  process.exit(0);
}

const renderer = await createCliRenderer({
  screenMode: 'alternate-screen',
  useMouse: true,
  exitOnCtrlC: false,
  clearOnShutdown: true,
});
const root = createRoot(renderer);
let shuttingDown = false;
const shutdown = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  root.unmount();
  renderer.destroy();
};

process.on('SIGINT', () => {
  shutdown();
  process.exit(130);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(143);
});

// Recent sessions offered on the setup screen's resume list. Skipped when
// already resuming (setup screen won't show) to avoid a pointless scan.
const recentSessions = resumeName ? [] : (await listSessions(storeRoot)).slice(0, 6);

type ResumeMount = {
  name: string;
  paths: ReturnType<typeof sessionPaths>;
  state?: State;
  prompt?: string;
  format: OutputFormat;
};

/** Load everything --resume <name> would have loaded, for an in-TUI pick. */
async function loadResumePick(pick: string): Promise<ResumeMount> {
  let fmt = outputFormat;
  if (!userExplicitFormat) {
    const detected = await detectSessionFormat(join(storeRoot, pick));
    if (detected) fmt = detected;
  }
  const p = sessionPaths(storeRoot, pick, fmt);
  const entries = await readTranscript(p.transcriptPath);
  const st =
    (entries.length > 0 ? rehydrateState(entries) : undefined) ?? undefined;
  let goal: string | undefined;
  try {
    const { readFile } = await import('node:fs/promises');
    goal = (await readFile(p.promptPath, 'utf8')).trim();
  } catch {
    goal = undefined;
  }
  return { name: pick, paths: p, state: st, prompt: goal, format: fmt };
}

// Tracks whichever session the mounted App is running, so the post-exit
// summary prints the right dir after an in-TUI resume pick.
let activeSession = { paths, name };

/**
 * Agents for a resumed session. Setup submit rebuilds agents via buildAgents,
 * but resume skips setup — a session that ran specialists would hit the
 * runner's "no agent registered" throw on the specialist's first turn.
 * Rebuild the full persona→agent map from the restored state instead.
 */
function agentsForResume(st?: State): Record<string, Agent> {
  const specialistIds = (st?.activePersonas ?? []).filter(
    id => id !== 'claude' && id !== 'codex',
  );
  if (specialistIds.length === 0) return { claude, codex };
  const personas = [
    CLAUDE_PERSONA,
    CODEX_PERSONA,
    ...SPECIALIST_PERSONAS.filter(p => specialistIds.includes(p.id)),
  ];
  const build = buildRealAgents ?? buildFakeAgents!;
  return build(
    {
      claudeModel: claudeModel ?? null,
      claudeEffort: claudeEffort ?? null,
      codexModel: codexModel ?? null,
      codexEffort: codexEffort ?? null,
    },
    personas,
  );
}

function mount(resume?: ResumeMount): void {
  if (resume) activeSession = { paths: resume.paths, name: resume.name };
  const mPaths = resume?.paths ?? paths;
  const mState = resume ? resume.state : resumedState ?? undefined;
  root.render(
    <App
      key={activeSession.name}
      agents={agentsForResume(mState)}
      prompt={resume ? resume.prompt : prompt || resumedPrompt}
      sessionName={activeSession.name}
      config={{ maxRounds }}
      mode={mode}
      initialState={mState}
      promptSidecarPath={mPaths.promptPath}
      transcriptPath={mPaths.transcriptPath}
      specPath={mPaths.specPath}
      outputFormat={resume?.format ?? outputFormat}
      debatePath={mPaths.debatePath}
      interviewPath={mPaths.interviewPath}
      checkpointPath={mPaths.checkpointPath}
      buildAgents={buildRealAgents ?? buildFakeAgents}
      buildModerator={buildModerator}
      initialModerator={effectiveModerator}
      initialCaucus={effectiveCaucus}
      // A resumed session keeps the intensity it was started with — the
      // transcript's value wins over the current flag/saved setting, else an
      // 'auto' session resumed under 'medium' would wait forever for answers
      // (and the inverse would silently auto-answer a manual session).
      initialInterview={mState?.interviewIntensity ?? effectiveInterview}
      simulatedUser={buildSimulatedUser()}
      initialModelConfig={{
        claudeModel: claudeModel ?? null,
        claudeEffort: claudeEffort ?? null,
        codexModel: codexModel ?? null,
        codexEffort: codexEffort ?? null,
      }}
      setupStorePath={savedSetupPath}
      initialSpecialists={effectiveSpecialists}
      sessions={resume ? undefined : recentSessions}
      onResume={
        resume
          ? undefined
          : pick => {
              loadResumePick(pick)
                .then(r => mount(r))
                .catch((err: unknown) => {
                  // A session we listed but can't load (corrupt transcript,
                  // permissions) — same failure CLI --resume hits. Die loudly
                  // rather than leaving Enter a silent no-op.
                  shutdown();
                  console.error(
                    `failed to resume ${pick}: ${err instanceof Error ? err.message : String(err)}`,
                  );
                  process.exit(1);
                });
            }
      }
      onQuit={shutdown}
      onDone={() => {
        // Finalization happens; user can ctrl-c or we let App quit when ready.
      }}
    />,
  );
}
mount();

renderer.start();
await new Promise<void>(resolve => {
  renderer.once('destroy', () => resolve());
});
await printSessionSummary(activeSession.paths, activeSession.name);
