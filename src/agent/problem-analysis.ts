import type { ProblemContext } from '../extraction/schema';
import type { LearnerSnapshot } from '../learner/schema';
import {
  PROBLEM_ANALYST_SYSTEM_PROMPT,
  buildProblemAnalysisInput,
} from '../prompts/analyze';
import type { ExtensionSettings } from '../storage/local';
import {
  ProblemAnalysisSchema,
  PROBLEM_ANALYSIS_MAX_OUTPUT_TOKENS,
  type ProblemAnalysis,
} from './schemas';
import { requestStructuredResponse } from './openai-client';
import type { SessionUsage } from './usage';

export async function analyzeProblem(
  problem: ProblemContext,
  learner: LearnerSnapshot,
  settings: ExtensionSettings,
  onActivity?: () => void,
  signal?: AbortSignal,
  onUsage?: (usage: SessionUsage) => void,
): Promise<ProblemAnalysis> {
  return requestStructuredResponse({
    settings,
    onActivity,
    instructions: PROBLEM_ANALYST_SYSTEM_PROMPT,
    prompt: buildProblemAnalysisInput(problem, learner),
    schema: ProblemAnalysisSchema,
    schemaName: 'private_problem_analysis',
    // This cap includes hidden reasoning tokens, not just the compact JSON map.
    maxOutputTokens: PROBLEM_ANALYSIS_MAX_OUTPUT_TOKENS,
    invalidResultMessage:
      'OpenAI returned an incomplete problem analysis. Try the request again.',
    signal,
    onUsage,
  });
}
