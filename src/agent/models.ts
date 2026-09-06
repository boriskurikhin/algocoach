export const COACH_MODEL = 'gpt-6-astra' as const;

export type CoachModel = typeof COACH_MODEL;

export type ModelReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
