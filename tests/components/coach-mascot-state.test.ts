import { describe, expect, it } from 'vitest';
import {
  deriveCoachMascotState,
  type CoachMascotContext,
} from '../../src/components/coach-mascot-state';

const baseContext: CoachMascotContext = {
  sessionId: 'session-1',
  extracting: false,
  status: null,
  composer: '',
  error: '',
  completed: false,
  messageCount: 2,
};

describe('coach mascot state', () => {
  it('reacts to the live conversation state by priority', () => {
    expect(
      deriveCoachMascotState({ ...baseContext, sessionId: null, messageCount: 0 }),
    ).toBe('greeting');
    expect(deriveCoachMascotState({ ...baseContext, extracting: true })).toBe(
      'reading',
    );
    expect(
      deriveCoachMascotState({ ...baseContext, composer: 'My current idea…' }),
    ).toBe('typing');
    expect(deriveCoachMascotState({ ...baseContext, status: 'coaching' })).toBe(
      'reading',
    );
    expect(deriveCoachMascotState({ ...baseContext, status: 'checking' })).toBe(
      'thinking',
    );
    expect(deriveCoachMascotState({ ...baseContext, error: 'Connection lost.' })).toBe(
      'support',
    );
  });

  it('uses simple terminal and quiet-session states', () => {
    expect(deriveCoachMascotState({ ...baseContext, completed: true })).toBe(
      'complete',
    );
    expect(deriveCoachMascotState(baseContext)).toBe('idle');
    expect(deriveCoachMascotState({ ...baseContext, messageCount: 1 })).toBe(
      'greeting',
    );
  });
});
