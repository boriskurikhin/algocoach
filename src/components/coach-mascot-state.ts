import type { CoachStage, CoachStatus } from '../agent/schemas';

export type CoachMascotState =
  | 'idle'
  | 'greeting'
  | 'typing'
  | 'reading'
  | 'thinking'
  | 'coaching'
  | 'aha'
  | 'celebrate'
  | 'nudge'
  | 'clarify'
  | 'support'
  | 'complete';

export type CoachMascotMoment = Extract<
  CoachMascotState,
  'aha' | 'celebrate' | 'nudge' | 'complete'
>;

export interface CoachMascotContext {
  sessionId: string | null;
  extracting: boolean;
  status: CoachStatus | null;
  draft: string;
  composer: string;
  error: string;
  stage: CoachStage;
  messageCount: number;
  moment: CoachMascotMoment | null;
}

const STAGE_ORDER: readonly CoachStage[] = [
  'listen',
  'clarify',
  'concretize',
  'contradiction',
  'boundary',
  'connect',
];

export const COACH_MASCOT_ASSET: Record<CoachMascotState, string> = {
  idle: '/mascot/idle.png',
  greeting: '/mascot/greeting.png',
  typing: '/mascot/user-typing.png',
  reading: '/mascot/reading.png',
  thinking: '/mascot/thinking.png',
  coaching: '/mascot/coaching.png',
  aha: '/mascot/aha.png',
  celebrate: '/mascot/celebrate.png',
  nudge: '/mascot/nudge.png',
  clarify: '/mascot/clarify.png',
  support: '/mascot/support.png',
  complete: '/mascot/complete.png',
};

export const COACH_MASCOT_LABEL: Record<CoachMascotState, string> = {
  idle: 'Coach is ready for your next thought',
  greeting: 'Coach welcomes you',
  typing: 'Coach is listening while you type',
  reading: 'Coach is reading your reasoning',
  thinking: 'Coach is thinking carefully',
  coaching: 'Coach is asking a guiding question',
  aha: 'Coach noticed a useful insight',
  celebrate: 'Coach is celebrating your progress',
  nudge: 'Coach suggests trying another angle',
  clarify: 'Coach invites you to clarify',
  support: 'Coach is here to help you get unstuck',
  complete: 'Coach is proud of your completed lesson',
};

export function coachMascotMomentForStageChange(
  previous: CoachStage,
  next: CoachStage,
): CoachMascotMoment {
  if (STAGE_ORDER.indexOf(next) <= STAGE_ORDER.indexOf(previous)) return 'nudge';
  if (next === 'connect') return 'complete';
  if (next === 'boundary') return 'celebrate';
  return 'aha';
}

export function deriveCoachMascotState({
  sessionId,
  extracting,
  status,
  draft,
  composer,
  error,
  stage,
  messageCount,
  moment,
}: CoachMascotContext): CoachMascotState {
  if (error) return 'support';
  if (draft.trim()) return 'coaching';
  if (extracting || status === 'studying' || status === 'coaching') return 'reading';
  if (status === 'checking') return 'thinking';
  if (status === 'saving-profile') return 'complete';
  if (moment) return moment;
  if (composer.trim()) return 'typing';
  if (!sessionId || (stage === 'listen' && messageCount <= 1)) return 'greeting';

  switch (stage) {
    case 'clarify':
      return 'clarify';
    case 'concretize':
      return 'coaching';
    case 'contradiction':
      return 'thinking';
    case 'boundary':
      return 'support';
    case 'connect':
      return 'complete';
    default:
      return 'idle';
  }
}
