import type { ProblemContext } from '../extraction/schema';
import type { LearnerSnapshot } from '../learner/schema';
import {
  PROBLEM_ANALYST_SYSTEM_PROMPT,
  buildProblemAnalysisInput,
} from '../prompts/analyze';
import type { ExtensionSettings } from '../storage/local';
import { requestStructuredResponse } from './openai-client';
import { reasoningPlanForProblem } from './reasoning';
import { ProblemAnalysisSchema, type ProblemAnalysis } from './schemas';

export async function analyzeProblem(input: {
  problem: ProblemContext;
  learner: LearnerSnapshot;
  settings: ExtensionSettings;
  signal?: AbortSignal;
}): Promise<ProblemAnalysis> {
  const { problem, learner, settings } = input;
  const reasoning = reasoningPlanForProblem(problem, 'analysis');
  return requestStructuredResponse({
    settings,
    instructions: PROBLEM_ANALYST_SYSTEM_PROMPT,
    prompt: buildProblemAnalysisInput(problem, learner),
    schema: ProblemAnalysisSchema,
    schemaName: 'private_problem_analysis',
    // This cap includes hidden reasoning tokens, not just the compact JSON map.
    maxOutputTokens: reasoning.maxOutputTokens,
    invalidResultMessage:
      'The coach received an incomplete problem analysis. Try again.',
    signal: input.signal,
    model: reasoning.model,
    reasoningEffort: reasoning.effort,
    promptCacheKey: 'socratic-coach:analysis',
  });
}
