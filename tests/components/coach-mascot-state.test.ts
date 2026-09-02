import { describe, expect, it } from 'vitest';
import {
  coachMascotMomentForStageChange,
  deriveCoachMascotState,
  type CoachMascotContext,
} from '../../src/components/coach-mascot-state';

const baseContext: CoachMascotContext = {
  sessionId: 'session-1',
  extracting: false,
  status: null,
  draft: '',
  composer: '',
  error: '',
  stage: 'listen',
  messageCount: 2,
  moment: null,
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
    expect(
      deriveCoachMascotState({
        ...baseContext,
        status: 'checking',
        draft: 'What changes if…',
      }),
    ).toBe('coaching');
    expect(deriveCoachMascotState({ ...baseContext, error: 'Connection lost.' })).toBe(
      'support',
    );
  });

  it('uses the hint stage for a quiet session', () => {
    expect(deriveCoachMascotState({ ...baseContext, stage: 'clarify' })).toBe(
      'clarify',
    );
    expect(deriveCoachMascotState({ ...baseContext, stage: 'concretize' })).toBe(
      'coaching',
    );
    expect(deriveCoachMascotState({ ...baseContext, stage: 'contradiction' })).toBe(
      'thinking',
    );
    expect(deriveCoachMascotState({ ...baseContext, stage: 'boundary' })).toBe(
      'support',
    );
    expect(deriveCoachMascotState({ ...baseContext, stage: 'connect' })).toBe(
      'celebrate',
    );
    expect(deriveCoachMascotState({ ...baseContext, stage: 'complete' })).toBe(
      'complete',
    );
  });

  it('turns stage changes into short progress reactions', () => {
    expect(coachMascotMomentForStageChange('listen', 'clarify')).toBe('aha');
    expect(coachMascotMomentForStageChange('contradiction', 'boundary')).toBe(
      'celebrate',
    );
    expect(coachMascotMomentForStageChange('boundary', 'connect')).toBe('celebrate');
    expect(coachMascotMomentForStageChange('connect', 'complete')).toBe('complete');
    expect(coachMascotMomentForStageChange('clarify', 'clarify')).toBe('nudge');
  });
});
