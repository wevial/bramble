/**
 * Persistent Codex transport using the OpenAI Responses API directly,
 * eliminating the per-turn subprocess spawn overhead of `codex exec`.
 *
 * Conversation continuity is maintained via `previous_response_id` so the
 * server sees the full debate history — enabling prompt caching and allowing
 * delta prompts to work (only new context needs to be sent each turn).
 *
 * Yields synthetic JSONL lines compatible with `parseCodexEvent` so
 * CodexAgent can consume them identically to the CLI path.
 */

export interface CodexTransport {
  runTurn(promptText: string, signal: AbortSignal): AsyncIterable<string>;
  sessionGeneration(): number;
  lastTurnGeneration(): number;
  dispose(): void;
}

export type CodexTransportOptions = {
  model?: string;
  reasoningEffort?: string;
  systemInstructions?: string;
  /** Override the API base URL. Default: OPENAI_BASE_URL env or https://api.openai.com/v1 */
  baseUrl?: string;
  /** Override the API key. Default: OPENAI_API_KEY env. */
  apiKey?: string;
};

export function createCodexTransport(
  opts: CodexTransportOptions,
): CodexTransport {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required for the persistent Codex transport',
    );
  }
  const model = opts.model ?? 'o4-mini';
  const baseUrl = (
    opts.baseUrl ??
    process.env.OPENAI_BASE_URL ??
    'https://api.openai.com/v1'
  ).replace(/\/+$/, '');

  let previousResponseId: string | null = null;
  let generation = 1;
  let turnGen = 1;
  let disposed = false;
  let turnLock: Promise<void> = Promise.resolve();

  const runTurn = (
    promptText: string,
    signal: AbortSignal,
  ): AsyncIterable<string> =>
    (async function* () {
      let release!: () => void;
      const prior = turnLock;
      turnLock = new Promise<void>(r => {
        release = r;
      });
      await prior;

      try {
        if (disposed || signal.aborted) return;
        turnGen = generation;

        const body: Record<string, unknown> = {
          model,
          input: promptText,
          stream: true,
        };
        if (opts.systemInstructions) {
          body.instructions = opts.systemInstructions;
        }
        if (opts.reasoningEffort) {
          body.reasoning = { effort: opts.reasoningEffort };
        }
        if (previousResponseId) {
          body.previous_response_id = previousResponseId;
        }

        const resp = await fetch(`${baseUrl}/responses`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal,
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          // Stale session — reset so the caller retries with a full prompt.
          // Only clear previousResponseId here; the catch block handles the
          // generation bump so we don't double-increment.
          if (
            previousResponseId &&
            (resp.status === 400 || resp.status === 404)
          ) {
            previousResponseId = null;
          }
          throw new Error(
            `OpenAI API error ${resp.status}: ${errText.slice(0, 500)}`,
          );
        }

        const reader = resp.body?.getReader();
        if (!reader) throw new Error('No response body from OpenAI API');

        const decoder = new TextDecoder();
        let buf = '';

        while (true) {
          if (signal.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const parts = buf.split('\n');
          buf = parts.pop() ?? '';

          for (const line of parts) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            let sseEvt: Record<string, unknown>;
            try {
              sseEvt = JSON.parse(data);
            } catch {
              continue;
            }
            const evtType = sseEvt.type as string | undefined;

            // Text delta -> synthetic Codex CLI `item.completed` event.
            if (evtType === 'response.output_text.delta') {
              const delta = sseEvt.delta;
              if (typeof delta === 'string' && delta.length > 0) {
                yield JSON.stringify({
                  type: 'item.completed',
                  item: { type: 'agent_message', text: delta },
                });
              }
            }

            // Response completed — capture ID for continuity + emit usage.
            if (evtType === 'response.completed') {
              const response = sseEvt.response as
                | Record<string, unknown>
                | undefined;
              if (response?.id && typeof response.id === 'string') {
                previousResponseId = response.id;
              }
              const usage = response?.usage as
                | Record<string, unknown>
                | undefined;
              const inputDetails = usage?.input_tokens_details as
                | Record<string, unknown>
                | undefined;
              yield JSON.stringify({
                type: 'turn.completed',
                usage: usage
                  ? {
                      input_tokens:
                        typeof usage.input_tokens === 'number'
                          ? usage.input_tokens
                          : 0,
                      output_tokens:
                        typeof usage.output_tokens === 'number'
                          ? usage.output_tokens
                          : 0,
                      cached_input_tokens:
                        typeof inputDetails?.cached_tokens === 'number'
                          ? inputDetails.cached_tokens
                          : 0,
                    }
                  : undefined,
              });
            }
          }
        }
      } catch (err) {
        if (!signal.aborted) {
          previousResponseId = null;
          generation++;
          throw err;
        }
      } finally {
        release();
      }
    })();

  return {
    runTurn,
    sessionGeneration() {
      return generation;
    },
    lastTurnGeneration() {
      return turnGen;
    },
    dispose() {
      disposed = true;
      previousResponseId = null;
    },
  };
}
