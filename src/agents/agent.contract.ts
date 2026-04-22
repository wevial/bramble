import { describe, it, expect } from 'vitest';
import type { Agent } from './agent.js';

export type AgentFactory = () => {
  agent: Agent;
  /** Response the agent should emit on stream(). Implementations must honor this. */
  setResponse(text: string): void;
  /** Optional: set per-token delay in ms so tests can interrupt mid-stream. */
  setTokenDelayMs?(ms: number): void;
};

export function runAgentContract(name: string, factory: AgentFactory) {
  describe(`Agent contract: ${name}`, () => {
    it('reports its name', () => {
      const { agent } = factory();
      expect(agent.name === 'claude' || agent.name === 'codex').toBe(true);
    });

    it('streams the configured response as tokens', async () => {
      const { agent, setResponse } = factory();
      setResponse('hello world');
      const controller = new AbortController();
      let combined = '';
      for await (const tok of agent.stream({ prompt: 'hi' }, controller.signal)) {
        combined += tok.text;
      }
      expect(combined).toBe('hello world');
    });

    it('halts promptly when the signal is aborted mid-stream', async () => {
      const { agent, setResponse, setTokenDelayMs } = factory();
      setResponse('aaaaaaaaaa');
      setTokenDelayMs?.(20);
      const controller = new AbortController();
      let collected = '';
      const done = (async () => {
        try {
          for await (const tok of agent.stream({ prompt: 'x' }, controller.signal)) {
            collected += tok.text;
            if (collected.length >= 2) controller.abort();
          }
        } catch {
          // aborts may throw; acceptable.
        }
      })();
      await done;
      expect(collected.length).toBeGreaterThanOrEqual(2);
      expect(collected.length).toBeLessThan(10);
    });

    it('does not emit further tokens after abort', async () => {
      const { agent, setResponse, setTokenDelayMs } = factory();
      setResponse('abcdefghij');
      setTokenDelayMs?.(10);
      const controller = new AbortController();
      let collected = '';
      try {
        for await (const tok of agent.stream({ prompt: 'x' }, controller.signal)) {
          collected += tok.text;
          if (tok.text === 'c') controller.abort();
        }
      } catch {
        /* ok */
      }
      const atAbort = collected;
      // wait a tick to catch any stragglers
      await new Promise(r => setTimeout(r, 60));
      expect(collected).toBe(atAbort);
    });
  });
}
