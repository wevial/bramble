export type Speaker = 'claude' | 'codex' | 'user';

export type TurnRecord = {
  speaker: Speaker;
  timestamp: string;
  content: string;
};

export type Draft = {
  body: string;
  proposer: 'claude' | 'codex';
};

export type State = {
  speaker: Speaker | 'idle';
  transcript: TurnRecord[];
  currentDraft: Draft | null;
  accepted: boolean;
};

export type Action =
  | { type: 'turnStarted'; speaker: Speaker }
  | { type: 'turnCompleted'; speaker: Speaker; content: string; timestamp: string }
  | { type: 'userInterjection'; content: string; timestamp: string }
  | { type: 'proposalReceived'; speaker: 'claude' | 'codex'; body: string }
  | { type: 'verdictReceived'; speaker: 'claude' | 'codex'; verdict: 'LGTM' | 'counter' };

export const initialState: State = {
  speaker: 'idle',
  transcript: [],
  currentDraft: null,
  accepted: false,
};
