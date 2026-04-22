export type Speaker = 'claude' | 'codex' | 'user';

export type TurnRecord = {
  speaker: Speaker;
  timestamp: string;
  content: string;
};

export type State = {
  speaker: Speaker | 'idle';
  transcript: TurnRecord[];
};

export type Action =
  | { type: 'turnStarted'; speaker: Speaker }
  | { type: 'turnCompleted'; speaker: Speaker; content: string; timestamp: string };

export const initialState: State = {
  speaker: 'idle',
  transcript: [],
};
