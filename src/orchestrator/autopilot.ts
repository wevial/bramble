import type { Agent } from '../agents/agent.js';
import type { Persona, PersonaId } from '../personas/personas.js';
import type { Moderator } from '../moderator/moderator.js';
import { startDebate } from './runner.js';
import type { State } from './state.js';

export type AutopilotOptions = {
  agents: Record<PersonaId, Agent>;
  personas: Persona[];
  moderator?: Moderator;
  prompt: string;
  transcriptPath: string;
  /** Cheap agent that role-plays the user answering interview questions. */
  simulatedUser: Agent;
  /** Interview questions to answer before forcing the debate. Default 3. */
  maxAnswers?: number;
  /** Debate round cap. */
  maxRounds?: number;
  /** Hard wall-clock cap; aborts the run if exceeded. Default 6 min. */
  timeoutMs?: number;
  /** Route interview→debate through the criteria phase. Default true. */
  criteriaStep?: boolean;
  /** Probe the cwd for repo context before the interview. Default true. */
  scoutStep?: boolean;
  /** Progress sink; defaults to console.log. */
  log?: (line: string) => void;
};

/**
 * Run a full debate to completion with no human in the loop: a cheap
 * `simulatedUser` agent answers interview questions until `maxAnswers` is hit,
 * then the interview is force-ended and the debate runs to signoff. Prints
 * phase/turn progress (including each turn's prompt mode, so delta prompts are
 * visible) and returns the final state.
 */
export async function runAutopilot(opts: AutopilotOptions): Promise<State> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const maxAnswers = opts.maxAnswers ?? 3;

  const ac = new AbortController();
  const timeout = setTimeout(() => {
    log(`\n[autopilot] timeout after ${Math.round((opts.timeoutMs ?? 360_000) / 1000)}s — aborting`);
    ac.abort();
  }, opts.timeoutMs ?? 360_000);

  // onState fires synchronously inside the runner's reducer dispatch, before
  // the runner reaches its await and installs the answer/signoff resolver.
  // interject() tolerates that (it queues), but done_interview() does not — if
  // it runs before the resolver exists, the userDone lands but the runner then
  // parks on a wait nothing resolves. Defer done_interview() to a macrotask so
  // the runner is already awaiting. Guard flags are still set synchronously to
  // prevent re-entry.
  const deferDone = () => setTimeout(() => handle.done_interview(), 0);

  let answers = 0;
  let forcedDebate = false;
  let finalizedSignoff = false;
  let lockedCriteria = false;
  // Turns we've already reacted to, by index, so a repeated onState for the
  // same turn doesn't double-answer. Interview and criteria track separately.
  const handled = new Set<number>();
  const handledCriteria = new Set<number>();
  let lastPhase = '';

  const label = (id: PersonaId) =>
    opts.personas.find(p => p.id === id)?.label ?? id;

  const handle = startDebate({
    agents: opts.agents,
    personas: opts.personas,
    moderator: opts.moderator,
    pauseEachRound: false,
    criteriaStep: opts.criteriaStep ?? true,
    scoutStep: opts.scoutStep ?? true,
    prompt: opts.prompt,
    config: opts.maxRounds ? { maxRounds: opts.maxRounds } : undefined,
    mode: 'auto',
    transcriptPath: opts.transcriptPath,
    signal: ac.signal,
    onUsage: (speaker, usage) => {
      const mode = (usage as { promptMode?: string }).promptMode;
      const tag = mode ? ` [${mode}]` : '';
      log(`  · ${label(speaker)} turn done${tag}`);
    },
    onState: next => {
      if (next.phase !== lastPhase) {
        log(`\n=== phase: ${next.phase} ===`);
        lastPhase = next.phase;
      }

      // Debate: after mutual LGTM the runner pauses for a human to sign off.
      // With no human, confirm it ourselves so the run finalizes to 'done'
      // instead of hanging on the signoff pause.
      if (next.phase === 'debate' && next.awaitingSignoff && !finalizedSignoff) {
        finalizedSignoff = true;
        log(`\n[autopilot] mutual LGTM — finalizing spec`);
        deferDone();
        return;
      }

      // Criteria: the runner pauses for user input after every proposal, and
      // only advances when the user "locks" the list. Let each persona propose
      // once, then lock via done_interview() so the debate can start.
      if (next.phase === 'criteria') {
        const cidx = next.criteriaTurns.length - 1;
        if (cidx < 0 || handledCriteria.has(cidx)) return;
        handledCriteria.add(cidx);
        if (next.criteriaTurns.length >= opts.personas.length) {
          if (!lockedCriteria) {
            lockedCriteria = true;
            log(`\n[autopilot] criteria proposed — locking and starting the debate`);
            deferDone();
          }
        } else {
          // Release the wait so the next persona proposes.
          handle.interject('Looks reasonable — please continue.');
        }
        return;
      }

      if (next.phase !== 'interview') return;

      // React to the newest interview turn if it asked a question and hasn't
      // signaled ready. interject() safely queues if the runner isn't yet
      // waiting for an answer, so we don't need to know the exact wait point.
      const idx = next.interview.length - 1;
      if (idx < 0 || handled.has(idx)) return;
      const turn = next.interview[idx]!;
      // A `ready` turn advances the interview on its own — nothing to do. Every
      // other turn (question, or a malformed/parse-fallback turn) leaves the
      // runner waiting for a user answer, so we must respond to unstick it.
      if (turn.ready) return;
      handled.add(idx);

      // Cap reached — stop clarifying and start the debate.
      if (answers >= maxAnswers) {
        if (!forcedDebate) {
          forcedDebate = true;
          log(`\n[autopilot] ${maxAnswers} answers given — starting the debate`);
          deferDone();
        }
        return;
      }

      // No explicit question (agent gave commentary only, or output was
      // unparseable) — release the wait with a neutral nudge, no LLM call.
      if (!turn.question) {
        handle.interject('Please proceed with sensible defaults.');
        return;
      }

      answers++;
      const qNum = answers;
      const question = turn.question;
      log(`\n[Q${qNum}] ${label(turn.speaker)}: ${question}`);
      // Fire-and-forget: generate an answer, then feed it back. Must not block
      // the synchronous onState dispatch.
      void answerQuestion(opts.simulatedUser, opts.prompt, question, ac.signal)
        .then(answer => {
          if (ac.signal.aborted) return;
          log(`[A${qNum}] ${answer}`);
          handle.interject(answer);
        })
        .catch(() => {
          if (!ac.signal.aborted) handle.interject('Use sensible defaults and proceed.');
        });
    },
  });

  try {
    const final = await handle.done;
    return final;
  } finally {
    clearTimeout(timeout);
    opts.simulatedUser.dispose?.();
  }
}

/** Ask the simulated-user agent to answer one interview question tersely. */
async function answerQuestion(
  user: Agent,
  goal: string,
  question: string,
  signal: AbortSignal,
): Promise<string> {
  const prompt =
    `Original goal: "${goal}"\n\n` +
    `An assistant scoping this goal asked you:\n"${question}"\n\n` +
    `Answer as the product owner in 1–2 concrete sentences. Choose specific, ` +
    `reasonable defaults. Do not ask questions back. Plain prose, no JSON.`;
  let text = '';
  let tail: { raw?: string } | void;
  // This runs during the interview phase — label the turn accordingly so an
  // agent that branches on TurnContext.phase applies the right expectations.
  const iter = user.stream({ phase: 'interview', prompt }, signal);
  while (true) {
    const r = await iter.next();
    if (r.done) {
      tail = r.value;
      break;
    }
    text += r.value.text;
  }
  const raw = (tail?.raw ?? text).trim();
  return raw.length > 0 ? raw : 'Use sensible defaults and proceed.';
}
