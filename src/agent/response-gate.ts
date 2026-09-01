import type { LearnerSnapshot } from '../learner/schema';
import { RESPONSE_GUARD_SYSTEM_PROMPT, buildGuardInput } from '../prompts/guard';
import { MAX_TEACHING_SNIPPET_LINES } from '../prompts/policy';
import type { ExtensionSettings } from '../storage/local';
import { isFocusedVisualization, type DrawConcept } from '../visualization/schema';
import { requestStructuredResponse } from './openai-client';
import {
  GuardResultSchema,
  type CoachStage,
  type CoachingMap,
  type GuardResult,
} from './schemas';
import type { SessionUsage } from './usage';

const stageOrder: CoachStage[] = [
  'listen',
  'clarify',
  'concretize',
  'contradiction',
  'boundary',
  'connect',
];

function clampStage(current: CoachStage, requested: CoachStage): CoachStage {
  const currentIndex = stageOrder.indexOf(current);
  const requestedIndex = stageOrder.indexOf(requested);
  return (
    stageOrder[Math.max(currentIndex, Math.min(requestedIndex, currentIndex + 1))] ??
    current
  );
}

export function hasObviousSolutionLeak(value: string): boolean {
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
  stage: CoachStage;
  latestLearnerMessage: string;
  candidateReply: string;
  visualization?: DrawConcept;
  coachingMap: CoachingMap;
  learner: LearnerSnapshot;
  problemKey: string;
  settings: ExtensionSettings;
  onActivity?: () => void;
  signal?: AbortSignal;
  onUsage?: (usage: SessionUsage) => void;
}): Promise<GuardResult> {
  const guarded = await requestStructuredResponse({
    settings: input.settings,
    onActivity: input.onActivity,
    instructions: RESPONSE_GUARD_SYSTEM_PROMPT,
    prompt: buildGuardInput(input),
    schema: GuardResultSchema,
    schemaName: 'guarded_coach_response',
    maxOutputTokens: 12_000,
    invalidResultMessage:
      'OpenAI returned an incomplete hint-safety check. Try the request again.',
    signal: input.signal,
    onUsage: input.onUsage,
    promptCacheKey: `socratic-coach:guard:${input.sessionId}`,
  });

  if (hasObviousSolutionLeak(guarded.safeReply)) {
    return {
      allowed: false,
      violations: ['overpowered-hint'],
      safeReply:
        'Let’s slow this down to one check. What should the key quantity represent before and after one tiny example?',
      nextStage: input.stage,
      allowVisualization: false,
      profileObservations: guarded.profileObservations,
    };
  }

  return {
    ...guarded,
    nextStage: clampStage(input.stage, guarded.nextStage),
    allowVisualization:
      guarded.allowed &&
      guarded.allowVisualization &&
      Boolean(input.visualization && isFocusedVisualization(input.visualization)),
  };
}
