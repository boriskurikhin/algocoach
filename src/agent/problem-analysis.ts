import type { ProblemContext } from '../extraction/schema';
import type { LearnerSnapshot } from '../learner/schema';
import {
  PROBLEM_ANALYST_SYSTEM_PROMPT,
  buildProblemAnalysisInput,
} from '../prompts/analyze';
import type { ExtensionSettings } from '../storage/local';
import { CoachingMapSchema, type CoachingMap } from './schemas';
import { requestStructuredResponse } from './openai-client';

export async function analyzeProblem(
  problem: ProblemContext,
  learner: LearnerSnapshot,
  settings: ExtensionSettings,
  onActivity?: () => void,
  signal?: AbortSignal,
): Promise<CoachingMap> {
  return requestStructuredResponse({
    settings,
    onActivity,
    instructions: PROBLEM_ANALYST_SYSTEM_PROMPT,
    prompt: buildProblemAnalysisInput(problem, learner),
    schema: CoachingMapSchema,
    schemaName: 'private_coaching_map',
    // This cap includes hidden reasoning tokens, not just the compact JSON map.
    maxOutputTokens: 12_000,
    invalidResultMessage:
      'OpenAI returned an incomplete problem analysis. Try the request again.',
    signal,
    reasoningMode: 'standard',
  });
}
