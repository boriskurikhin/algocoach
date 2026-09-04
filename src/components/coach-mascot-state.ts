import type { CoachStatus } from '../agent/schemas';

export type CoachMascotState =
  'idle' | 'greeting' | 'typing' | 'reading' | 'thinking' | 'support' | 'complete';

export interface CoachMascotContext {
  sessionId: string | null;
  extracting: boolean;
  status: CoachStatus | null;
  composer: string;
  error: string;
  completed: boolean;
  messageCount: number;
}

export const COACH_MASCOT_ASSET: Record<CoachMascotState, string> = {
  idle: '/mascot/idle.png',
  greeting: '/mascot/greeting.png',
  typing: '/mascot/user-typing.png',
  reading: '/mascot/reading.png',
  thinking: '/mascot/thinking.png',
  support: '/mascot/support.png',
  complete: '/mascot/complete.png',
};

export const COACH_MASCOT_LABEL: Record<CoachMascotState, string> = {
  idle: 'Coach is ready for your next thought',
  greeting: 'Coach welcomes you',
  typing: 'Coach is listening while you type',
  reading: 'Coach is reading your reasoning',
  thinking: 'Coach is thinking carefully',
  support: 'Coach is here to help you get unstuck',
  complete: 'Coaching session is complete',
};

export function deriveCoachMascotState({
  sessionId,
  extracting,
  status,
  composer,
  error,
  completed,
  messageCount,
}: CoachMascotContext): CoachMascotState {
  if (error) return 'support';
  if (extracting || status === 'studying' || status === 'coaching') return 'reading';
  if (status === 'checking') return 'thinking';
  if (completed) return 'complete';
  if (composer.trim()) return 'typing';
  return !sessionId || messageCount <= 1 ? 'greeting' : 'idle';
}
