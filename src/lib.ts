/**
 * Public library entry: drive bramble debates in-process from another Bun
 * program (a Claude Code Workflow script, an agent harness, a test rig)
 * without the MCP subprocess boundary.
 *
 * The engine is the same session registry the `bramble mcp` server wraps:
 * `McpSessionManager.start()` launches a debate in the background and
 * returns a live `McpSession`; poll `sessionWaiting(session)` and release
 * waits with `manager.answer()` / `manager.finish()` exactly as the MCP
 * tools do. `session.finalize` resolves once the spec and checkpoint are
 * on disk.
 *
 * ```ts
 * import { McpSessionManager, sessionWaiting } from 'bramble';
 *
 * const mgr = new McpSessionManager({
 *   root: './.bramble', cwd: process.cwd(), mock: false, format: 'md',
 * });
 * const session = mgr.start({ goal: 'design an auth system' });
 * // poll sessionWaiting(session); mgr.answer(session, text) at
 * // interview/criteria waits, mgr.finish(session) to advance/accept.
 * await session.finalize;
 * ```
 *
 * Bun-only, like the rest of bramble. Keep this surface in sync with the
 * MCP server — anything the six tools can do should be reachable here.
 */

export {
  McpSessionManager,
  SessionExistsError,
  sessionWaiting,
  waitingOf,
  buildMockAgents,
  type McpSession,
  type StartParams,
  type ManagerOptions,
  type Waiting,
  type SessionStatus,
} from './mcp/sessions.js';

export type {
  State,
  EndReason,
  InterviewIntensity,
} from './orchestrator/state.js';

export { convertSpec, type OutputFormat } from './docs/format.js';
export { readSpec } from './docs/spec.js';
export {
  listSessions,
  sessionPaths,
  type SessionRow,
  type SessionPaths,
} from './sessions/list.js';
export type { PersonaId, Persona } from './personas/personas.js';
export { SPECIALIST_PERSONAS } from './personas/personas.js';
