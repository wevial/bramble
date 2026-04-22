import { FakeAgent } from './fake.js';
import { runAgentContract } from './agent.contract.js';

runAgentContract('FakeAgent', () => {
  const agent = new FakeAgent('claude');
  return {
    agent,
    setResponse: (text: string) => agent.setResponse(text),
    setTokenDelayMs: (ms: number) => agent.setTokenDelayMs(ms),
  };
});
