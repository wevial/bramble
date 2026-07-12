import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { join } from 'node:path';
import {
  McpSessionManager,
  SessionExistsError,
  waitingOf,
  sessionWaiting,
  type McpSession,
  type Waiting,
} from './sessions.js';
import type { State } from '../orchestrator/state.js';
import { sessionPaths, type SessionPaths } from '../sessions/list.js';
import { convertSpec, type OutputFormat } from '../docs/format.js';

// ---------------------------------------------------------------------------
// Human-in-the-loop instruction copy (constraint 2). Addressed to the CALLING
// agent: relay to the human verbatim, never answer on their behalf.
// ---------------------------------------------------------------------------

function instructionFor(w: Waiting, name: string): string | null {
  switch (w.kind) {
    case 'interview':
      return (
        'ACTION REQUIRED — RELAY TO YOUR HUMAN. bramble is interviewing the human who\n' +
        'owns this goal, not you. Present the question below to your human user verbatim\n' +
        'through your own ask-the-user / elicitation channel, then wait. Do NOT answer\n' +
        'it yourself, guess, or infer an answer from the conversation or repo — you are\n' +
        'only the wire between bramble and the human. When the human replies, call\n' +
        `bramble_answer with session "${name}" and their exact words. If the human wants\n` +
        'to stop clarifying and let the agents start drafting, call bramble_done instead.\n\n' +
        `QUESTION (from ${w.speaker}): ${w.question}`
      );
    case 'criteria':
      return (
        'ACTION REQUIRED — RELAY TO YOUR HUMAN. The agents have proposed success\n' +
        "criteria for this spec and are waiting on the human's review — not yours. Show\n" +
        'the proposed list below to your human user verbatim and ask what they want\n' +
        'changed. Do NOT edit, approve, or invent criteria on their behalf. Pass the\n' +
        `human's revision back with bramble_answer (session "${name}"); the agents will\n` +
        'revise and re-propose. When the human is satisfied, call bramble_done to lock\n' +
        'the list and open the debate.\n\n' +
        `PROPOSED CRITERIA (from ${w.speaker}):\n` +
        w.proposed.map((c, i) => `${i + 1}. ${c}`).join('\n')
      );
    case 'signoff':
      return (
        'ACTION REQUIRED — RELAY TO YOUR HUMAN. The agents have reached mutual LGTM on\n' +
        'the spec and are holding for the human\'s sign-off — not yours. Fetch the spec\n' +
        `with bramble_get_spec (session "${name}") and show it to your human user. Do NOT\n` +
        'accept it yourself. If the human wants changes, send them with bramble_answer\n' +
        `(session "${name}") — that re-opens the debate for another round. If the human\n` +
        'accepts, call bramble_done to finalize; spec.<ext> and checkpoint.md are then\n' +
        'written to the session directory.'
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

/** Full status shape shared by status / answer / done results. */
function statusPayload(
  s: McpSession,
  message?: string,
): Record<string, unknown> {
  const st = s.state;
  const w = sessionWaiting(s);
  const payload: Record<string, unknown> = {
    session: s.name,
    status: s.status,
    phase: st.phase,
    round: st.round,
    endReason: st.endReason ?? null,
    waiting: w,
    instruction: instructionFor(w, s.name),
    activePersonas: st.activePersonas,
    turnCounts: {
      interview: st.interview.length,
      criteria: st.criteriaTurns.length,
      debate: st.debate.length,
    },
    specChars: st.spec.length,
    lastSpeaker: st.speaker,
    artifacts: {
      dir: s.paths.dir,
      specPath: s.paths.specPath,
      checkpointPath: s.paths.checkpointPath,
      transcriptPath: s.paths.transcriptPath,
    },
  };
  if (s.status === 'error' && s.error) payload.error = s.error;
  if (message) payload.message = message;
  return payload;
}

function detachedStatusPayload(
  name: string,
  st: State,
  paths: SessionPaths,
): Record<string, unknown> {
  const w = waitingOf(st);
  return {
    session: name,
    status: 'detached',
    phase: st.phase,
    round: st.round,
    endReason: st.endReason ?? null,
    // No live handle — the caller can read but not act, so no instruction.
    waiting: w.kind === 'done' ? w : { kind: 'thinking' },
    instruction: null,
    activePersonas: st.activePersonas,
    turnCounts: {
      interview: st.interview.length,
      criteria: st.criteriaTurns.length,
      debate: st.debate.length,
    },
    specChars: st.spec.length,
    lastSpeaker: st.speaker,
    artifacts: {
      dir: paths.dir,
      specPath: paths.specPath,
      checkpointPath: paths.checkpointPath,
      transcriptPath: paths.transcriptPath,
    },
    message:
      "session is detached from an earlier server run; it's read-only " +
      '(status / get_spec / list only, no answer / done).',
  };
}

/** Let macrotask-deferred release calls settle, then re-read fresh state. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 40));
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

const INTERVIEW_VALUES = ['none', 'low', 'medium', 'high'] as const;
const EFFORT_VALUES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const CODEX_EFFORT_VALUES = ['low', 'medium', 'high'] as const;
const SPECIALIST_VALUES = ['security', 'perf', 'ux', 'naming', 'ops'] as const;
const FORMAT_VALUES = ['md', 'xml', 'json', 'html'] as const;

/**
 * Build the MCP server around a session manager. Kept separate from the
 * stdio wiring so tests can connect it to an InMemoryTransport.
 */
export function buildMcpServer(mgr: McpSessionManager): McpServer {
  const server = new McpServer({ name: 'bramble', version: '0.0.1' });

  server.registerTool(
    'bramble_start',
    {
      description:
        'Start a new bramble spec-debate session as a background job and return ' +
        'immediately with its session name. Call this once per goal you want two AI ' +
        'agents (Claude and Codex) to debate into a written spec. It does NOT run the ' +
        'debate to completion or return a spec — it kicks off an async pipeline ' +
        '(scout → interview → criteria → optional caucus → debate) and returns while ' +
        'that runs. After calling it you MUST poll bramble_status with the returned ' +
        'session name to drive the session forward: the session will pause and wait ' +
        'for the human who owns this goal to answer interview questions, review ' +
        'success criteria, and sign off on the final spec, and bramble_status tells ' +
        'you when a human answer is needed and hands you the exact question to relay. ' +
        'Never set interview intensity to "auto" — in MCP mode you are the channel ' +
        'that carries the human\'s answers, so there is no automatic answerer. Choose ' +
        'mock: true only for testing the tool wiring without real CLIs.',
      inputSchema: {
        goal: z.string().min(1),
        name: z.string().min(1).optional(),
        interview: z
          .string()
          .optional()
          .superRefine((v, ctx) => {
            if (v === undefined) return;
            if (v === 'auto')
              ctx.addIssue({
                code: 'custom',
                message:
                  "interview 'auto' is not allowed over MCP: the calling agent relays " +
                  'questions to the human, so there is no automatic answerer. Use ' +
                  "'none', 'low', 'medium', or 'high'.",
              });
            else if (!INTERVIEW_VALUES.includes(v as (typeof INTERVIEW_VALUES)[number]))
              ctx.addIssue({
                code: 'custom',
                message: `unknown interview intensity '${v}'; use none | low | medium | high`,
              });
          }),
        specialists: z.array(z.enum(SPECIALIST_VALUES)).optional(),
        caucus: z.boolean().optional(),
        moderator: z.boolean().optional(),
        rounds: z.number().int().min(1).max(50).optional(),
        claudeModel: z.string().optional(),
        claudeEffort: z.enum(EFFORT_VALUES).optional(),
        codexModel: z.string().optional(),
        codexEffort: z.enum(CODEX_EFFORT_VALUES).optional(),
        format: z.enum(FORMAT_VALUES).optional(),
        mock: z.boolean().optional(),
        cwd: z.string().optional(),
      },
    },
    async args => {
      let session: McpSession;
      try {
        session = mgr.start({
          goal: args.goal,
          name: args.name,
          interview: args.interview as
            | 'none'
            | 'low'
            | 'medium'
            | 'high'
            | undefined,
          specialists: args.specialists,
          caucus: args.caucus,
          moderator: args.moderator,
          rounds: args.rounds,
          claudeModel: args.claudeModel,
          claudeEffort: args.claudeEffort,
          codexModel: args.codexModel,
          codexEffort: args.codexEffort,
          format: args.format as OutputFormat | undefined,
          mock: args.mock,
          cwd: args.cwd,
        });
      } catch (err) {
        if (err instanceof SessionExistsError)
          throw new McpError(ErrorCode.InvalidParams, err.message);
        // Real mode missing a CLI (or any construction failure) surfaces here.
        throw new McpError(
          ErrorCode.InternalError,
          `failed to start session: ${(err as Error).message}`,
        );
      }
      const st = session.state;
      const w = sessionWaiting(session);
      return jsonResult({
        session: session.name,
        status: session.status,
        phase: st.phase,
        goal: session.goal,
        dir: session.paths.dir,
        waiting: w,
        instruction: instructionFor(w, session.name),
        message:
          `Session started in the background. Poll bramble_status with session ` +
          `"${session.name}" until waiting.kind is interview/criteria/signoff ` +
          `(relay to your human) or done.`,
      });
    },
  );

  server.registerTool(
    'bramble_status',
    {
      description:
        'Get the current state of a running bramble session and, crucially, find out ' +
        'whether it is waiting on the human. Call this repeatedly after bramble_start ' +
        'and after every bramble_answer/bramble_done to drive the session forward — it ' +
        'is your polling loop. Read waiting.kind: "thinking" means the agents are ' +
        'working and you should poll again shortly; "interview", "criteria", and ' +
        '"signoff" each mean bramble is blocked on the human who owns this goal, and ' +
        'the instruction field gives you the exact words to relay to your human plus ' +
        'which tool to call with their reply — follow it literally and never answer on ' +
        'the human\'s behalf; "done" means the session finished and the spec + ' +
        'checkpoint are written to disk (fetch the spec with bramble_get_spec). This ' +
        'tool is read-only and never advances the session by itself.',
      inputSchema: { session: z.string().min(1) },
    },
    async args => {
      const live = mgr.get(args.session);
      if (live) return jsonResult(statusPayload(live));
      const det = await mgr.loadDetached(args.session);
      if (det)
        return jsonResult(
          detachedStatusPayload(args.session, det.state, det.paths),
        );
      throw new McpError(
        ErrorCode.InvalidParams,
        `no session named '${args.session}'; call bramble_list to see sessions`,
      );
    },
  );

  server.registerTool(
    'bramble_answer',
    {
      description:
        'Deliver the human\'s reply into a bramble session that is waiting for input. ' +
        'Call this ONLY with words that came from your human user, and ONLY when the ' +
        'latest bramble_status shows waiting.kind of interview, criteria, or signoff — ' +
        'never with an answer you produced yourself. The meaning depends on the wait: ' +
        'during interview it answers the pending question; during criteria it is a ' +
        'revision request that makes the agents refine and re-propose (use ' +
        'bramble_done to lock the list); during signoff any text is treated as "the ' +
        'human wants changes" and re-opens the debate. After calling, poll ' +
        'bramble_status again to see the next question or state.',
      inputSchema: {
        session: z.string().min(1),
        text: z.string().min(1),
      },
    },
    async args => {
      const session = mgr.get(args.session);
      if (!session) {
        const det = await mgr.loadDetached(args.session);
        if (det)
          throw new McpError(
            ErrorCode.InvalidRequest,
            `session '${args.session}' is detached from this server; it cannot accept new input`,
          );
        throw new McpError(
          ErrorCode.InvalidParams,
          `no session named '${args.session}'; call bramble_list to see sessions`,
        );
      }
      if (session.releasePending)
        throw new McpError(
          ErrorCode.InvalidRequest,
          `session '${args.session}' already has an answer/done being applied; ` +
            'poll bramble_status before sending another (never answer twice for one wait)',
        );
      const w = sessionWaiting(session);
      if (session.status === 'done' || w.kind === 'done')
        throw new McpError(
          ErrorCode.InvalidRequest,
          `session '${args.session}' is finished; nothing to answer`,
        );
      if (w.kind === 'thinking')
        throw new McpError(
          ErrorCode.InvalidRequest,
          `session '${args.session}' is not waiting for input right now (agents are ` +
            'mid-turn); poll bramble_status and answer only when waiting.kind is ' +
            'interview/criteria/signoff',
        );
      // Claim the wait synchronously so a concurrent bramble_answer can't also
      // pass the guard above and get queued as the NEXT turn's answer.
      session.releasePending = true;
      try {
        mgr.answer(session, args.text);
        await settle();
      } finally {
        session.releasePending = false;
      }
      return jsonResult(
        statusPayload(
          session,
          'Answer delivered. Poll bramble_status for the next question.',
        ),
      );
    },
  );

  server.registerTool(
    'bramble_done',
    {
      description:
        'Tell a waiting bramble session that the human is finished with the current ' +
        'phase and it should move on — the "advance/finalize" counterpart to ' +
        'bramble_answer. Call it, on the human\'s instruction, when bramble_status ' +
        'shows: interview and the human wants to stop clarifying; criteria and the ' +
        'human is happy with the proposed criteria and wants them locked; or signoff ' +
        'and the human accepts the final spec (this finalizes the session and writes ' +
        'spec.<ext> and checkpoint.md). It takes no free text — for changes or answers ' +
        'use bramble_answer instead.',
      inputSchema: { session: z.string().min(1) },
    },
    async args => {
      const session = mgr.get(args.session);
      if (!session) {
        const det = await mgr.loadDetached(args.session);
        if (det)
          throw new McpError(
            ErrorCode.InvalidRequest,
            `session '${args.session}' is detached from this server; it cannot accept new input`,
          );
        throw new McpError(
          ErrorCode.InvalidParams,
          `no session named '${args.session}'; call bramble_list to see sessions`,
        );
      }
      const st = session.state;
      if (session.status === 'done' || st.phase === 'done')
        throw new McpError(
          ErrorCode.InvalidRequest,
          `session '${args.session}' is already finished`,
        );
      if (session.releasePending)
        throw new McpError(
          ErrorCode.InvalidRequest,
          `session '${args.session}' already has an answer/done being applied; ` +
            'poll bramble_status before sending another',
        );
      // Gate on the ACTUAL wait, not just the phase. A phase check alone lets
      // done fire while an interview/criteria agent is still streaming (the
      // wait shape isn't up yet): done_interview then advances the phase and
      // the in-flight turn gets parsed by the wrong phase's parser, corrupting
      // the session. sessionWaiting also filters the already-answered window.
      const w = sessionWaiting(session);
      if (w.kind !== 'interview' && w.kind !== 'criteria' && w.kind !== 'signoff')
        throw new McpError(
          ErrorCode.InvalidRequest,
          `nothing to finalize: session '${args.session}' is not at an ` +
            'interview/criteria/signoff wait (agents are mid-turn); poll ' +
            'bramble_status and call bramble_done only when waiting.kind is ' +
            'interview/criteria/signoff',
        );
      const wasSignoff = w.kind === 'signoff';
      session.releasePending = true;
      try {
        mgr.finish(session);
        await settle();
        // On the finalize path, wait for the spec/checkpoint writes to actually
        // land before reporting success — otherwise the client could act on
        // "finalized" (and close stdio → process.exit) before the files exist.
        if (wasSignoff) await session.finalize;
      } finally {
        session.releasePending = false;
      }
      return jsonResult(
        statusPayload(
          session,
          wasSignoff
            ? 'Spec finalized. Fetch it with bramble_get_spec.'
            : 'Phase advanced. Poll bramble_status for the next state.',
        ),
      );
    },
  );

  server.registerTool(
    'bramble_get_spec',
    {
      description:
        'Fetch the spec text a bramble session has produced — the in-flight draft ' +
        'while the debate is running, or the accepted final spec once the session is ' +
        'done. Call this to show the human the spec at sign-off time (when ' +
        'bramble_status reports waiting.kind: signoff), and again after the session ' +
        'finishes to retrieve the deliverable. The accepted flag tells you whether ' +
        'this is the final locked spec (true) or a work-in-progress draft (false). ' +
        'This is read-only.',
      inputSchema: {
        session: z.string().min(1),
        format: z.enum(FORMAT_VALUES).optional(),
      },
    },
    async args => {
      const live = mgr.get(args.session);
      if (live) {
        const st = live.state;
        const fmt = (args.format as OutputFormat | undefined) ?? live.format;
        const body = convertSpec(st.spec, fmt);
        return jsonResult({
          session: live.name,
          phase: st.phase,
          accepted: st.phase === 'done' && st.endReason === 'mutual_lgtm',
          endReason: st.endReason ?? null,
          format: fmt,
          specChars: body.length,
          spec: body,
          path: sessionPaths(mgr.root, live.name, fmt).specPath,
        });
      }
      const det = await mgr.loadDetached(
        args.session,
        args.format as OutputFormat | undefined,
      );
      if (!det)
        throw new McpError(
          ErrorCode.InvalidParams,
          `no session named '${args.session}'; call bramble_list to see sessions`,
        );
      // Default to the session's STORED format (det.format), not 'md' — else
      // the body/format we return would disagree with det.paths.specPath.
      const fmt = (args.format as OutputFormat | undefined) ?? det.format;
      const body = convertSpec(det.state.spec, fmt);
      return jsonResult({
        session: args.session,
        phase: det.state.phase,
        accepted:
          det.state.phase === 'done' &&
          det.state.endReason === 'mutual_lgtm',
        endReason: det.state.endReason ?? null,
        format: fmt,
        specChars: body.length,
        spec: body,
        path: det.paths.specPath,
      });
    },
  );

  server.registerTool(
    'bramble_list',
    {
      description:
        'List bramble sessions — both the live background jobs this server is running ' +
        'and any completed sessions already on disk under the storage root. Call it to ' +
        'discover session names when you have lost track of one, to check which ' +
        'sessions are still waiting on the human, or to survey past specs. Each row ' +
        'tells you the goal, current phase/status, whether a spec was accepted, and ' +
        'whether the session is still live (answerable) or detached from an earlier ' +
        'server run. Read-only.',
      inputSchema: { dir: z.string().optional() },
    },
    async args => {
      const root = args.dir
        ? args.dir.startsWith('/')
          ? args.dir
          : join(mgr.cwd, args.dir)
        : mgr.root;
      const rows = await mgr.list(root);
      const seen = new Set<string>();
      const sessions: Record<string, unknown>[] = [];
      for (const r of rows) {
        seen.add(r.name);
        const live = root === mgr.root ? mgr.get(r.name) : undefined;
        if (live) {
          const w = sessionWaiting(live);
          sessions.push({
            name: live.name,
            goal: live.goal || r.goal,
            live: true,
            status: live.status,
            phase: live.state.phase,
            waiting: w.kind,
            turns: r.turns,
            accepted:
              live.state.phase === 'done' &&
              live.state.endReason === 'mutual_lgtm',
            created: live.createdAt,
            updated: live.updatedAt,
          });
        } else {
          sessions.push({
            name: r.name,
            goal: r.goal,
            live: false,
            status: 'detached',
            phase: null,
            waiting: null,
            turns: r.turns,
            accepted: r.accepted,
            created: r.created ? r.created.toISOString() : null,
            updated: r.updated.toISOString(),
          });
        }
      }
      // Live sessions whose transcript hasn't hit disk yet won't appear in rows.
      if (root === mgr.root) {
        for (const live of mgr.liveSessions()) {
          if (seen.has(live.name)) continue;
          const w = sessionWaiting(live);
          sessions.push({
            name: live.name,
            goal: live.goal,
            live: true,
            status: live.status,
            phase: live.state.phase,
            waiting: w.kind,
            turns:
              live.state.interview.length +
              live.state.criteriaTurns.length +
              live.state.debate.length,
            accepted:
              live.state.phase === 'done' &&
              live.state.endReason === 'mutual_lgtm',
            created: live.createdAt,
            updated: live.updatedAt,
          });
        }
      }
      sessions.sort((a, b) =>
        String(b.updated).localeCompare(String(a.updated)),
      );
      return jsonResult({ root, sessions });
    },
  );

  return server;
}

export type RunMcpServerOptions = {
  root: string;
  cwd: string;
  mock: boolean;
  format: OutputFormat;
  claudeModel?: string;
  claudeEffort?: string;
  codexModel?: string;
  codexEffort?: string;
};

/**
 * Headless entry: wire the server to stdio and block until the transport
 * closes. All diagnostics go to stderr — stdout is owned by JSON-RPC.
 */
export async function runMcpServer(opts: RunMcpServerOptions): Promise<void> {
  const mgr = new McpSessionManager({
    root: opts.root,
    cwd: opts.cwd,
    mock: opts.mock,
    format: opts.format,
    models: {
      claudeModel: opts.claudeModel ?? null,
      claudeEffort: opts.claudeEffort ?? null,
      codexModel: opts.codexModel ?? null,
      codexEffort: opts.codexEffort ?? null,
    },
  });
  const server = buildMcpServer(mgr);
  const transport = new StdioServerTransport();
  console.error(
    `[bramble mcp] serving on stdio · store=${opts.root} · ` +
      `agents=${opts.mock ? 'mock' : 'real'} · format=${opts.format}`,
  );
  await server.connect(transport);
  await new Promise<void>(resolve => {
    transport.onclose = () => resolve();
  });
}
