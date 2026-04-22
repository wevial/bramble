import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { Agent } from '../agents/agent.js';
import { runDebate } from '../orchestrator/runner.js';
import type { TurnRecord } from '../orchestrator/types.js';

export type AppProps = {
  agents: { claude: Agent; codex: Agent };
  prompt: string;
  rounds: number;
  transcriptPath: string;
  onDone?: () => void;
};

type LiveStream = { claude: string; codex: string };

export function App({ agents, prompt, rounds, transcriptPath, onDone }: AppProps) {
  const [live, setLive] = useState<LiveStream>({ claude: '', codex: '' });
  const [transcript, setTranscript] = useState<TurnRecord[]>([]);
  const [speaker, setSpeaker] = useState<'claude' | 'codex' | 'idle'>('idle');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let currentSpeaker: 'claude' | 'codex' | null = null;
    let buf = '';

    (async () => {
      await runDebate({
        agents,
        prompt,
        rounds,
        transcriptPath,
        signal: controller.signal,
        onToken: (who, text) => {
          if (who !== currentSpeaker) {
            currentSpeaker = who;
            buf = '';
            setSpeaker(who);
            setLive(prev => ({ ...prev, [who]: '' }));
          }
          buf += text;
          const snapshot = buf;
          setLive(prev => ({ ...prev, [who]: snapshot }));
        },
      }).then(final => {
        setTranscript(final.transcript);
        setSpeaker('idle');
        setDone(true);
        onDone?.();
      });
    })();

    return () => controller.abort();
  }, []);

  return (
    <Box flexDirection="column">
      <Box>
        <Pane title="Claude" active={speaker === 'claude'} content={live.claude} />
        <Pane title="Codex" active={speaker === 'codex'} content={live.codex} />
      </Box>
      <Box flexDirection="column" borderStyle="single" paddingX={1}>
        <Text dimColor>transcript ({transcript.length} turns)</Text>
        {transcript.map((t, i) => (
          <Text key={i}>
            <Text color={t.speaker === 'claude' ? 'cyan' : 'magenta'}>{t.speaker}</Text>: {t.content}
          </Text>
        ))}
      </Box>
      <Box>
        <Text dimColor>
          {done ? 'done' : `speaker: ${speaker}`} · prompt: {prompt}
        </Text>
      </Box>
    </Box>
  );
}

function Pane({ title, active, content }: { title: string; active: boolean; content: string }) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width="50%">
      <Text bold color={active ? 'green' : undefined}>
        {title}
        {active ? ' ●' : ''}
      </Text>
      <Text>{content}</Text>
    </Box>
  );
}
