import type { Action, State } from './types.js';

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'turnStarted':
      return { ...state, speaker: action.speaker };
    case 'turnCompleted':
      return {
        ...state,
        speaker: 'idle',
        transcript: [
          ...state.transcript,
          {
            speaker: action.speaker,
            content: action.content,
            timestamp: action.timestamp,
          },
        ],
      };
    case 'userInterjection':
      return {
        ...state,
        transcript: [
          ...state.transcript,
          { speaker: 'user', content: action.content, timestamp: action.timestamp },
        ],
      };
  }
}
