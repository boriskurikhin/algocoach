import type { ProblemContext } from '../extraction/schema';
import {
  COACH_RESPONSE_MAX_OUTPUT_TOKENS,
  PROBLEM_ANALYSIS_MAX_OUTPUT_TOKENS,
  RESPONSE_GUARD_MAX_OUTPUT_TOKENS,
} from './schemas';
import { COACH_MODEL, type CoachModel, type ModelReasoningEffort } from './models';

type ModelTask = 'analysis' | 'coach' | 'guard';

interface ModelReasoningPlan {
  model: CoachModel;
  effort: ModelReasoningEffort;
  maxOutputTokens: number;
}

const UNKNOWN_PROBLEM_RATING = 1_600;

const OUTPUT_BUDGETS: Record<ModelReasoningEffort, Record<ModelTask, number>> = {
  low: { analysis: 8_000, coach: 6_000, guard: 4_000 },
  medium: { analysis: 16_000, coach: 10_000, guard: 6_000 },
  high: { analysis: 32_000, coach: 20_000, guard: 10_000 },
  xhigh: { analysis: 48_000, coach: 32_000, guard: 16_000 },
  max: {
    analysis: PROBLEM_ANALYSIS_MAX_OUTPUT_TOKENS,
    coach: COACH_RESPONSE_MAX_OUTPUT_TOKENS,
    guard: RESPONSE_GUARD_MAX_OUTPUT_TOKENS,
  },
};

function effortForRating(rating: number): ModelReasoningEffort {
  if (rating <= 1_200) return 'low';
  if (rating <= 1_900) return 'medium';
  if (rating < 2_500) return 'high';
  if (rating < 3_000) return 'xhigh';
  return 'max';
}

function ratingForReasoning(problem: ProblemContext): number | null {
  if (problem.codeforcesRating) return problem.codeforcesRating.value;

  const siteRating = problem.rating?.toLowerCase();
  if (!siteRating) return null;

  const numericRating = siteRating.match(
    /(?:^|\D)(800|900|[12]\d{3}|3\d{3}|4000)(?:\D|$)/,
  )?.[1];
  if (numericRating) return Number(numericRating);

  if (/\bplatinum\b/.test(siteRating)) return 2_600;
  if (/\b(?:hard|gold)\b/.test(siteRating)) return 2_100;
  if (/\b(?:medium|silver)\b/.test(siteRating)) return 1_600;
  if (/\b(?:easy|bronze)\b/.test(siteRating)) return 1_000;
  return null;
}

export function reasoningPlanForRating(
  rating: number | null,
  task: ModelTask,
): ModelReasoningPlan {
  const effectiveRating = rating ?? UNKNOWN_PROBLEM_RATING;
  const effort = effortForRating(effectiveRating);
  return {
    model: COACH_MODEL,
    effort,
    maxOutputTokens: OUTPUT_BUDGETS[effort][task],
  };
}

export function reasoningPlanForProblem(
  problem: ProblemContext,
  task: ModelTask,
): ModelReasoningPlan {
  return reasoningPlanForRating(ratingForReasoning(problem), task);
}
