import type { LearnerSnapshot } from '../learner/schema';
import { RESPONSE_GUARD_SYSTEM_PROMPT, buildGuardInput } from '../prompts/guard';
import { MAX_TEACHING_SNIPPET_LINES } from '../prompts/policy';
import type { ExtensionSettings } from '../storage/local';
import { isFocusedVisualization, type DrawConcept } from '../visualization/schema';
import { requestStructuredResponse } from './openai-client';
import { reasoningPlanForRating } from './reasoning';
import {
  GuardResultSchema,
  type ChatMessage,
  type CoachingMap,
  type GuardResult,
} from './schemas';

const OPTIMAL_SOLUTION_REPLY =
  'Yes — you’ve arrived at an optimal solution. Your core algorithm and target ' +
  'complexity match the intended approach. This coaching session is complete.';

function hasObviousSolutionLeak(value: string): boolean {
  const snippets = [...value.matchAll(/```[\w+#-]*\n?([\s\S]*?)```/g)].map(
    (match) => match[1] ?? '',
  );
  const unsafeSnippet =
    (value.match(/```/g)?.length ?? 0) % 2 !== 0 ||
    snippets.length > 1 ||
    snippets.some(
      (snippet) =>
        snippet.length > 600 ||
        snippet.trim().split('\n').length > MAX_TEACHING_SNIPPET_LINES ||
        /\b(?:class|def|function|fn|func)\s+\w+|(?:^|\n)\s*(?:[\w:<>,*&]+\s+)+\w+\s*\([^;]*\)\s*\{/i.test(
          snippet,
        ),
    );
  const surrenderPhrase =
    /\b(?:here(?:'s| is) (?:the|a) (?:full )?(?:solution|implementation)|complete code|copy and paste this)\b/i.test(
      value,
    );
  const pseudocodeBlock =
    /(?:^|\n)\s*(?:for|while|if)\b.*\n\s*(?:for|while|if|return|update)\b/im.test(
      value,
    );
  return unsafeSnippet || surrenderPhrase || pseudocodeBlock;
}

export async function guardCoachResponse(input: {
  sessionId: string;
  latestLearnerMessage: string;
  candidateReply: string;
  visualization?: DrawConcept;
  coachingMap: CoachingMap;
  learner: LearnerSnapshot;
  problemKey: string;
  codeforcesRating?: number;
  conversation: ChatMessage[];
  settings: ExtensionSettings;
  signal?: AbortSignal;
}): Promise<GuardResult> {
  const reasoning = reasoningPlanForRating(input.codeforcesRating ?? null, 'guard');
  const guarded = await requestStructuredResponse({
    settings: input.settings,
    instructions: RESPONSE_GUARD_SYSTEM_PROMPT,
    prompt: buildGuardInput(input),
    schema: GuardResultSchema,
    schemaName: 'guarded_coach_response',
    maxOutputTokens: reasoning.maxOutputTokens,
    invalidResultMessage: 'The coach received an incomplete safety check. Try again.',
    signal: input.signal,
    model: reasoning.model,
    reasoningEffort: reasoning.effort,
    promptCacheKey: `socratic-coach:guard:${input.sessionId}`,
  });

  if (guarded.solutionStatus === 'optimal') {
    return {
      ...guarded,
      safeReply: OPTIMAL_SOLUTION_REPLY,
      allowVisualization: false,
    };
  }

  if (hasObviousSolutionLeak(guarded.safeReply)) {
    return {
      safeReply:
        'Let’s stay with the part you’re working on rather than jump to a full ' +
        'solution. Tell me the specific claim, step, or code behavior you want ' +
        'to examine together.',
      solutionStatus: 'in-progress',
      allowVisualization: false,
      profileObservations: guarded.profileObservations,
    };
  }

  return {
    ...guarded,
    allowVisualization:
      guarded.allowVisualization &&
      Boolean(input.visualization && isFocusedVisualization(input.visualization)),
  };
}
