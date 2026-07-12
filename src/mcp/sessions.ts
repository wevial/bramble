import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Agent } from '../agents/agent.js';
import { ClaudeAgent } from '../agents/claude.js';
import { CodexAgent } from '../agents/codex.js';
import {
  CLAUDE_PERSONA,
  CODEX_PERSONA,
  SPECIALIST_PERSONAS,
  type Persona,
  type PersonaId,
} from '../personas/personas.js';
import { systemInstructions } from '../prompts/system.js';
import { startDebate, type RunHandle } from '../orchestrator/runner.js';
import type {
  State,
  EndReason,
  InterviewIntensity,
} from '../orchestrator/state.js';
import { rehydrateState } from '../orchestrator/replay.js';
import { readTranscript } from '../docs/transcript.js';
import type { SessionModels } from '../docs/transcript.js';
import { writeSpec, readSpec } from '../docs/spec.js';
import { writeCheckpoint } from '../docs/checkpoint.js';
import { convertSpec, type OutputFormat } from '../docs/format.js';
import {
  listSessions,
  sessionPaths,
  detectSessionFormat,
  type SessionPaths,
  type SessionRow,
} from '../sessions/list.js';
import { generateSessionName } from '../util/name.js';
import {
  LLMModerator,
  RoundRobinModerator,
  type Moderator,
} from '../moderator/moderator.js';
import { CHEAP_CODEX_MODEL } from '../ui/models.js';

export type SessionStatus =
  | 'running'
  | 'awaiting_input'
  | 'done'
  | 'error'
  | 'aborted';

/**
 * What a session is blocked on, derived purely from its latest State. Every
 * tool routes its behavior through this — it is the single source of truth
 * for whether a human answer is needed and which release call applies.
 */
export type Waiting =
  | { kind: 'interview'; speaker: PersonaId; question: string; commentary: string }
  | { kind: 'criteria'; speaker: PersonaId; proposed: string[]; commentary: string }
  | { kind: 'signoff'; spec: string }
  | { kind: 'done'; endReason: EndReason }
  | { kind: 'thinking' };

/**
 * done and signoff are checked before phase-specific waits: an awaitingSignoff
 * session is still phase 'debate', and a done session may still carry stale
 * phase-wait shapes.
 */
export function waitingOf(s: State): Waiting {
  if (s.phase === 'done' && s.endReason)
    return { kind: 'done', endReason: s.endReason };
  if (s.awaitingSignoff) return { kind: 'signoff', spec: s.spec };
  if (s.phase === 'criteria' && s.speaker === 'idle' && s.criteriaTurns.length > 0) {
    const t = s.criteriaTurns[s.criteriaTurns.length - 1]!;
    return {
      kind: 'criteria',
      speaker: t.speaker,
      proposed: t.proposed,
      commentary: t.commentary,
    };
  }
  if (s.phase === 'interview' && s.speaker === 'idle' && s.interview.length > 0) {
    const t = s.interview[s.interview.length - 1]!;
    if (!t.ready)
      return {
        kind: 'interview',
        speaker: t.speaker,
        question: t.question ?? '',
        commentary: t.commentary,
      };
  }
  return { kind: 'thinking' };
}

/**
 * waitingOf, adjusted for what THIS server already delivered. waitingOf is a
 * pure function of State and can't see that an interview/criteria answer was
 * just consumed: after a release the runner leaves state at the old wait shape
 * (speaker 'idle', same last turn) for the whole duration of the next
 * moderator.pick — seconds, with a real LLM moderator. During that window a
 * genuine wait and an already-answered one are indistinguishable from State
 * alone, so we down-rank the answered one to 'thinking' using the per-session
 * watermark. A NEW turn (interview.length / criteriaTurns.length past the
 * watermark) means the agents actually asked something new — surface it.
 */
export function sessionWaiting(s: McpSession): Waiting {
  const w = waitingOf(s.state);
  if (w.kind === 'interview' && s.state.interview.length <= s.releasedInterviewLen)
    return { kind: 'thinking' };
  if (w.kind === 'criteria' && s.state.criteriaTurns.length <= s.releasedCriteriaLen)
    return { kind: 'thinking' };
  return w;
}

export type McpSession = {
  name: string;
  goal: string;
  handle: RunHandle;
  paths: SessionPaths;
  personas: Persona[];
  format: OutputFormat;
  state: State;
  status: SessionStatus;
  error?: string;
  abort: AbortController;
  createdAt: string;
  updatedAt: string;
  /**
   * True while an answer/done release is in flight (scheduled but not yet
   * observably settled). Set synchronously by the tool handlers so a second
   * concurrent bramble_answer/bramble_done can't race on the same wait and
   * silently consume a later question.
   */
  releasePending: boolean;
  /**
   * Watermark: interview.length at the moment the last interview answer was
   * delivered. A live interview wait is genuine only when a NEW interview turn
   * has appeared since (interview.length > this). Without it, waitingOf still
   * reports the just-answered question during the runner's seconds-long
   * moderator.pick (speaker stays 'idle', the last turn is unchanged), so the
   * calling agent would be told to re-relay a question the human already
   * answered.
   */
  releasedInterviewLen: number;
  /** Watermark: criteriaTurns.length when the last criteria answer landed. */
  releasedCriteriaLen: number;
  /**
   * Resolves once handle.done has resolved AND the final spec/checkpoint have
   * been written to disk. bramble_done awaits this on the finalize path so it
   * never reports "Spec finalized" before the artifacts actually exist.
   */
  finalize: Promise<void>;
};

export type StartParams = {
  goal: string;
  name?: string;
  interview?: InterviewIntensity;
  specialists?: string[];
  caucus?: boolean;
  moderator?: boolean;
  rounds?: number;
  claudeModel?: string;
  claudeEffort?: string;
  codexModel?: string;
  codexEffort?: string;
  format?: OutputFormat;
  mock?: boolean;
  cwd?: string;
};

export type ManagerOptions = {
  root: string;
  cwd: string;
  /** Default agent backing when a start call omits `mock`. */
  mock: boolean;
  /** Default spec output format when a start call omits `format`. */
  format: OutputFormat;
  /** Default model/effort applied when a start call omits them. */
  models?: Partial<SessionModels>;
};

/** Thrown by start() when the requested name is already live. */
export class SessionExistsError extends Error {}

/**
 * Owns the process-lifetime registry of live debate sessions plus the
 * bridge to on-disk artifacts from prior processes. Not persisted across
 * restarts — prior-process sessions are read-only ("detached").
 */
export class McpSessionManager {
  readonly root: string;
  readonly cwd: string;
  readonly mock: boolean;
  readonly format: OutputFormat;
  private readonly defaultModels: Partial<SessionModels>;
  private readonly sessions = new Map<string, McpSession>();

  constructor(opts: ManagerOptions) {
    this.root = opts.root;
    this.cwd = opts.cwd;
    this.mock = opts.mock;
    this.format = opts.format;
    this.defaultModels = opts.models ?? {};
  }

  get(name: string): McpSession | undefined {
    return this.sessions.get(name);
  }

  liveSessions(): McpSession[] {
    return [...this.sessions.values()];
  }

  start(p: StartParams): McpSession {
    const name = p.name ?? generateSessionName();
    if (this.sessions.has(name))
      throw new SessionExistsError(`session '${name}' already exists`);
    const format = p.format ?? this.format;
    const mock = p.mock ?? this.mock;
    const cwd = p.cwd ?? this.cwd;
    const paths = sessionPaths(this.root, name, format);
    // Also reject names already on disk from a prior server run. Detached
    // sessions are read-only; appending a second run to an existing
    // transcript.jsonl would give it two 'session' entries and break replay.
    // (transcript.jsonl is format-independent, so this catches any format.)
    if (existsSync(paths.transcriptPath))
      throw new SessionExistsError(
        `session '${name}' already exists on disk; pick a different name`,
      );
    mkdirSync(paths.dir, { recursive: true });
    // Persist the goal as prompt.txt so bramble_list can populate the goal for
    // this session after a restart (it's detached-only then, read off disk).
    try {
      writeFileSync(paths.promptPath, p.goal, 'utf8');
    } catch (err) {
      console.error(
        `[bramble mcp] ${name}: could not write prompt.txt: ${(err as Error).message}`,
      );
    }

    const personas: Persona[] = [
      CLAUDE_PERSONA,
      CODEX_PERSONA,
      ...SPECIALIST_PERSONAS.filter(x => (p.specialists ?? []).includes(x.id)),
    ];
    const modelConfig: SessionModels = {
      claudeModel: p.claudeModel ?? this.defaultModels.claudeModel ?? null,
      claudeEffort: p.claudeEffort ?? this.defaultModels.claudeEffort ?? null,
      codexModel: p.codexModel ?? this.defaultModels.codexModel ?? null,
      codexEffort: p.codexEffort ?? this.defaultModels.codexEffort ?? null,
    };
    const agents = mock
      ? buildMockAgents(personas)
      : buildRealAgents(modelConfig, personas, cwd);
    const abort = new AbortController();
    const now = new Date().toISOString();

    // Populated by onState before startDebate returns (the runner fires the
    // initial onState synchronously); the non-null assertions below are
    // discharged by that same-tick call.
    const session = {
      name,
      goal: p.goal,
      paths,
      personas,
      format,
      status: 'running',
      abort,
      createdAt: now,
      updatedAt: now,
      releasePending: false,
      releasedInterviewLen: 0,
      releasedCriteriaLen: 0,
    } as McpSession;

    let lastPhase = '';
    const handle = startDebate({
      agents,
      personas,
      moderator: p.moderator ? buildModerator(personas, mock, cwd) : undefined,
      // MCP has no per-round human gate — the only debate-phase wait is signoff.
      pauseEachRound: false,
      criteriaStep: true,
      caucusStep: p.caucus ?? false,
      scoutStep: true,
      cwd,
      models: mock ? undefined : modelConfig,
      interviewIntensity: p.interview,
      prompt: p.goal,
      config: p.rounds != null ? { maxRounds: p.rounds } : undefined,
      mode: 'auto',
      transcriptPath: paths.transcriptPath,
      signal: abort.signal,
      // Constraint 1: stdout belongs to JSON-RPC — every sink goes to stderr.
      onState: next => {
        session.state = next;
        session.updatedAt = new Date().toISOString();
        session.status = statusOf(sessionWaiting(session));
        if (next.phase !== lastPhase) {
          console.error(`[bramble mcp] ${name}: phase → ${next.phase}`);
          lastPhase = next.phase;
        }
      },
      onNotice: (speaker, notice) =>
        console.error(`[bramble mcp] ${name}: ${speaker}: ${notice}`),
      onUsage: () => {},
    });
    session.handle = handle;

    // Mirrors the autopilot finalize path so on-disk deliverables land whether
    // the session ends via bramble_done, decay, or the round cap. Exposed as
    // session.finalize so bramble_done can await the actual writes before it
    // tells the caller the spec is finalized (otherwise a fixed 40ms settle
    // can return success while the writes are still pending, and the client
    // closing stdio could race process.exit against them).
    session.finalize = handle.done
      .then(async final => {
        session.state = final;
        session.status = abort.signal.aborted ? 'aborted' : 'done';
        // Don't swallow write failures — a "done" status with missing
        // artifacts is a silent data-loss trap. Surface on stderr (stdout is
        // JSON-RPC) and record it on the session.
        try {
          await writeSpec(paths.specPath, convertSpec(final.spec, format));
        } catch (err) {
          session.error = `failed to write spec: ${(err as Error).message}`;
          console.error(`[bramble mcp] ${name}: ${session.error}`);
        }
        try {
          await writeCheckpoint(paths.checkpointPath, final, personas);
        } catch (err) {
          const msg = `failed to write checkpoint: ${(err as Error).message}`;
          session.error = session.error ? `${session.error}; ${msg}` : msg;
          console.error(`[bramble mcp] ${name}: ${msg}`);
        }
      })
      .catch((err: unknown) => {
        session.status = 'error';
        session.error = String((err as Error)?.message ?? err);
        console.error(`[bramble mcp] ${name}: run failed: ${session.error}`);
      });

    this.sessions.set(name, session);
    return session;
  }

  /**
   * Deliver a human answer. Deferred to a macrotask (constraint 4) so the
   * runner has installed its resolver even when a poll races an in-flight
   * onState dispatch.
   */
  answer(session: McpSession, text: string): void {
    // Watermark the wait we're releasing so sessionWaiting() stops reporting
    // this same question/proposal while the runner spends the next
    // moderator.pick with state parked at the old wait shape.
    const st = session.state;
    if (st.phase === 'interview') session.releasedInterviewLen = st.interview.length;
    else if (st.phase === 'criteria')
      session.releasedCriteriaLen = st.criteriaTurns.length;
    setTimeout(() => session.handle.interject(text), 0);
  }

  /** Advance/finalize the current wait. Deferred for the same reason. */
  finish(session: McpSession): void {
    setTimeout(() => session.handle.done_interview(), 0);
  }

  abortSession(session: McpSession): void {
    session.abort.abort();
  }

  /** On-disk sessions from a prior process, unioned with the live registry. */
  async list(root: string): Promise<SessionRow[]> {
    return listSessions(root);
  }

  /**
   * Rehydrate a prior-process session's state from its transcript. Returns
   * null when no transcript exists under the name.
   */
  async loadDetached(
    name: string,
    format?: OutputFormat,
  ): Promise<{ state: State; paths: SessionPaths; format: OutputFormat } | null> {
    const fmt =
      format ?? (await detectSessionFormat(sessionPaths(this.root, name).dir)) ?? 'md';
    const paths = sessionPaths(this.root, name, fmt);
    let entries;
    try {
      entries = await readTranscript(paths.transcriptPath);
    } catch {
      return null;
    }
    if (entries.length === 0) return null;
    const state = rehydrateState(entries);
    if (!state) return null;
    // Return the resolved format so callers report a body/format/path that
    // agree — defaulting the format to 'md' would mismatch an XML session.
    return { state, paths, format: fmt };
  }

  /** Read a session's spec off disk (for detached sessions). */
  async readDiskSpec(paths: SessionPaths): Promise<string> {
    return readSpec(paths.specPath);
  }

  /** Best-effort read of a prompt sidecar, for list rows. */
  async readGoal(paths: SessionPaths): Promise<string> {
    try {
      return (await readFile(paths.promptPath, 'utf8')).trim();
    } catch {
      return '';
    }
  }
}

function statusOf(w: Waiting): SessionStatus {
  if (w.kind === 'done') return 'done';
  return w.kind === 'thinking' ? 'running' : 'awaiting_input';
}

// ---------------------------------------------------------------------------
// Agent construction
// ---------------------------------------------------------------------------

/**
 * Real-agent map, mirroring buildRealAgents in src/index.tsx: primaries get
 * read-only repo tools (Read/Grep/Glob for claude, sandbox read-only for
 * codex) since MCP runs inside the user's repo; specialists stay tool-less.
 */
function buildRealAgents(
  config: SessionModels,
  personas: Persona[],
  cwd: string,
): Record<PersonaId, Agent> {
  const result: Record<PersonaId, Agent> = {};
  for (const persona of personas) {
    const others = personas.filter(p => p.id !== persona.id);
    const sys = systemInstructions(persona, others);
    const grantTools = persona.scope === 'primary';
    if (persona.transport === 'claude') {
      result[persona.id] = new ClaudeAgent({
        model: config.claudeModel ?? undefined,
        reasoningEffort: config.claudeEffort ?? undefined,
        cwd,
        systemInstructions: sys,
        allowedTools: grantTools ? ['Read', 'Grep', 'Glob'] : undefined,
      });
    } else {
      result[persona.id] = new CodexAgent({
        model: config.codexModel ?? undefined,
        reasoningEffort: config.codexEffort ?? undefined,
        cwd,
        systemInstructions: sys,
        sandbox: grantTools ? 'read-only' : undefined,
      });
    }
  }
  return result;
}

function buildModerator(
  personas: Persona[],
  mock: boolean,
  cwd: string,
): Moderator {
  if (mock) return new RoundRobinModerator();
  const agent = new CodexAgent({
    model: CHEAP_CODEX_MODEL,
    reasoningEffort: 'low',
    cwd,
    systemInstructions:
      'You are a debate moderator. Output one JSON object per request, nothing else.',
  });
  return new LLMModerator({ agent, personas });
}

const MOCK_SPEC =
  '# Authentication Spec\n\n' +
  '## Goals\nEmail + password auth for internal tools, SSO-first.\n\n' +
  '## Success Criteria\n- Users can log in with email + password.\n' +
  '- Sessions expire after 30 minutes idle.\n';

/**
 * Deterministic fake agents for --mock. Phase-aware (like buildFakeSpecialist
 * in src/index.tsx) rather than a fixed response cycle, so the same agent
 * emits interview / criteria / caucus / debate JSON as the phase demands
 * regardless of scheduling order. Drives a full pipeline to signoff.
 */
export function buildMockAgents(
  personas: Persona[],
): Record<PersonaId, Agent> {
  const result: Record<PersonaId, Agent> = {};
  for (const persona of personas) {
    result[persona.id] =
      persona.scope === 'primary'
        ? mockPrimary(persona)
        : mockSpecialist(persona);
  }
  return result;
}

function mockPrimary(persona: Persona): Agent {
  const n = { interview: 0, criteria: 0, caucus: 0, debate: 0 };
  const isClaude = persona.id === 'claude';
  return {
    name: persona.transport,
    async *stream(ctx, signal) {
      const i = n[ctx.phase]++;
      let body: unknown;
      let display: string;
      if (ctx.phase === 'interview') {
        if (isClaude && i === 0) {
          display = 'Scoping the users before mechanics.';
          body = {
            commentary: display,
            question: 'Who are the primary users of this system?',
            ready: false,
          };
        } else {
          display = isClaude
            ? 'I have enough to start drafting.'
            : 'Nothing to add — ready.';
          body = { commentary: display, question: null, ready: true };
        }
      } else if (ctx.phase === 'criteria') {
        display = `${persona.label}: proposing measurable criteria.`;
        body = {
          commentary: display,
          proposed: [
            'Users can log in with email + password',
            'Sessions expire after 30 minutes idle',
          ],
        };
      } else if (ctx.phase === 'caucus') {
        display = `${persona.label}: independent opening position.`;
        // Carry both keys so proposal and synthesis parsers each find theirs.
        body = {
          commentary: display,
          proposal: 'SSO-first with an email + password fallback.',
          summary: 'SSO-first with an email + password fallback.',
        };
      } else {
        if (isClaude && i === 0) {
          display = 'Seeding the spec from the interview answers.';
          body = {
            commentary: display,
            edits: [{ find: '', replace: MOCK_SPEC }],
            verdict: 'lgtm',
          };
        } else {
          display = `${persona.label}: looks solid. lgtm.`;
          body = { commentary: display, edits: [], verdict: 'lgtm' };
        }
      }
      if (!signal.aborted) {
        await tick(signal);
        if (!signal.aborted) yield { text: display };
      }
      return { raw: JSON.stringify(body) };
    },
  };
}

function mockSpecialist(persona: Persona): Agent {
  return {
    name: persona.transport,
    async *stream(ctx, signal) {
      let body: unknown;
      let display: string;
      if (ctx.phase === 'interview') {
        display = `${persona.label}: no further questions — ready.`;
        body = { commentary: display, question: null, ready: true };
      } else if (ctx.phase === 'criteria') {
        display = `${persona.label}: no criteria to add.`;
        body = { commentary: display, proposed: [] };
      } else if (ctx.phase === 'caucus') {
        display = `${persona.label}: deferring to the primaries.`;
        body = { commentary: display, proposal: '', summary: '' };
      } else {
        display = `${persona.label}: my concerns are covered. lgtm.`;
        body = { commentary: display, edits: [], verdict: 'lgtm' };
      }
      if (!signal.aborted) {
        await tick(signal);
        if (!signal.aborted) yield { text: display };
      }
      return { raw: JSON.stringify(body) };
    },
  };
}

function tick(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, 1);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
