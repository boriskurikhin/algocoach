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
  const snippets = [...value.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)];
  const invalidSnippet =
    (value.match(/```/g)?.length ?? 0) !== snippets.length * 2 ||
    snippets.length > 1 ||
    snippets.some(
      ([, language = '', snippet = '']) =>
        !/^[\w+#.-]+$/.test(language) ||
        snippet.length > 600 ||
        snippet.trim().split('\n').length > MAX_TEACHING_SNIPPET_LINES,
    );
  const functionDefinition = [
    /\bdef\s+\w+\s*\([^)]*\)\s*(?:->[^:\n]+)?:/,
    /\b(?:function\s*\*?\s*(?:\w+\s*)?|(?:fn|func|fun)\s+\w+\s*)\([^)]*\)[^{\n]*\{/,
    /\bclass\s+\w+(?:\([^)]*\)|\s+extends\s+\w+)?\s*[{:]/,
    /(?:^|\n|`)[ \t]*(?!(?:else|return|if|for|while|switch|catch)\b)(?:[\w:<>,*&[\]]+[ \t]+)+\w+\s*\([^;{}]*\)\s*(?:const\s*)?\{/,
    /\b(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>/,
    /\b\w+\s*=\s*lambda\b/,
  ].some((pattern) => pattern.test(value));
  const solutionIntroduction =
    /\b(?:here(?:'s| is) (?:the|a) (?:full )?(?:solution|implementation)|copy and paste this)\b/i.test(
      value,
    );
  const solutionFlow =
    /(?:^|\n)[ \t]*(?:for|while|if)\b[^\n]*\n[ \t]+(?:for|while|if|return|update)\b/im.test(
      value,
    );
  return invalidSnippet || functionDefinition || solutionIntroduction || solutionFlow;
}

const INSPECTION_MOVES = [
  [
    /^(?:if|else\s+if|elif|switch|case)\b/,
    'What boundary values should make this condition true or false?',
  ],
  [
    /^(?:for|while)\b/,
    'What must remain true across each iteration, and which values test the stopping point?',
  ],
  [
    /(?:\+\+|--|[+*/%&|^-]=)/,
    'What are the affected values immediately before and after this update?',
  ],
  [
    /^return\b/,
    'What quantity does this expression represent, and does it match the required output?',
  ],
  [
    /(?:^|[^=!<>])=(?!=)/,
    'What should the assigned value mean, and where is it next used?',
  ],
] as const;

function codeInspectionTargets(value: string): string[] {
  const block = value.match(/```[^\n`]*\n([\s\S]*?)```/);
  return (block?.[1] ?? value)
    .split('\n')
    .flatMap((line, index) => {
      const code = line.trim();
      const priority = INSPECTION_MOVES.findIndex(([pattern]) => pattern.test(code));
      if (priority < 0 || /^(?:\/\/|#|\/\*|\*)/.test(code)) return [];
      // Reference source positions without echoing untrusted code or comments.
      const location = `line ${index + 1} of your ${block ? 'first code block' : 'pasted code'}`;
      return [
        {
          priority,
          question: `Inspect ${location}. ${INSPECTION_MOVES[priority]![1]}`,
        },
      ];
    })
    .sort((a, b) => a.priority - b.priority)
    .map(({ question }) => question);
}

function isGenericCodeDeflection(reply: string, latestLearnerMessage: string): boolean {
  return (
    codeInspectionTargets(latestLearnerMessage).length > 0 &&
    [
      /what (?:would you like|do you want) (?:me|us) to (?:help with|examine|inspect|look at|focus on)/i,
      /where (?:would you like|do you want) (?:me|us) to (?:start|look|focus)/i,
      /which (?:part|line|area|claim|step|code behavior).{0,60}(?:should|do) (?:we|you) (?:examine|inspect|focus on|look at)/i,
      /tell me (?:the )?(?:specific )?(?:part|line|area|claim|step|code behavior).{0,60}you (?:want|would like) to (?:examine|inspect|focus on|look at)/i,
    ].some((pattern) => pattern.test(reply))
  );
}

function actionableRecovery(input: {
  latestLearnerMessage: string;
  conversation: ChatMessage[];
}): string {
  const priorReplies = input.conversation
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content);
  const learnerTexts = [
    input.latestLearnerMessage,
    ...input.conversation
      .filter((message) => message.role === 'user')
      .toReversed()
      .map((message) => message.content),
  ];
  let targets: string[] = [];
  for (const text of learnerTexts) {
    targets = codeInspectionTargets(text);
    if (targets.length) break;
  }
  const questions = [
    ...targets,
    'Choose one small input and write down the output you expect. Which condition in the statement determines it?',
    'Show the values from your last trace, stopping at the first value you could not explain.',
  ];
  return (
    questions.find((question) => !priorReplies.includes(question)) ?? questions.at(-1)!
  );
}

export async function guardCoachResponse(input: {
  sessionId: string;
  latestLearnerMessage: string;
  candidateReply: string;
  visualization?: DrawConcept;
  coachingMap: CoachingMap;
  personalizationEnabled: boolean;
  codeforcesRating?: number;
  conversation: ChatMessage[];
  settings: ExtensionSettings;
  signal?: AbortSignal;
}): Promise<GuardResult & { safeReply: string }> {
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

  const approved = GuardResultSchema.shape.safeReply
    .unwrap()
    .safeParse(guarded.safeReply ?? input.candidateReply);
  const safeReply = approved.success ? approved.data : '';
  const profileObservations = input.personalizationEnabled
    ? guarded.profileObservations
    : [];
  if (guarded.solutionStatus === 'optimal') {
    return {
      ...guarded,
      safeReply: OPTIMAL_SOLUTION_REPLY,
      profileObservations,
      allowVisualization: false,
    };
  }

  if (
    !approved.success ||
    hasObviousSolutionLeak(safeReply) ||
    isGenericCodeDeflection(safeReply, input.latestLearnerMessage)
  ) {
    return {
      safeReply: actionableRecovery(input),
      solutionStatus: 'in-progress',
      allowVisualization: false,
      profileObservations,
    };
  }

  return {
    ...guarded,
    safeReply,
    profileObservations,
    allowVisualization:
      guarded.allowVisualization &&
      Boolean(input.visualization && isFocusedVisualization(input.visualization)),
  };
}
