import { zodResponsesFunction } from 'openai/helpers/zod';
import type { LearnerSnapshot } from '../learner/schema';
import { SOCRATIC_COACH_SYSTEM_PROMPT, buildCoachInput } from '../prompts/coach';
import type { ExtensionSettings } from '../storage/local';
import { DrawConceptSchema, type DrawConcept } from '../visualization/schema';
import { requestModelResponse } from './openai-client';
import { reasoningPlanForProblem } from './reasoning';
import type { CoachingSession } from './schemas';

const drawConceptTool = zodResponsesFunction({
  name: 'draw_concept',
  description:
    'Draw one compact teaching figure when a tiny state, range, or path makes the current idea easier to see. Reuse one stable scaffold, change one thing per frame, use emphasis sparingly, and end with a prediction. Never show the full solution.',
  parameters: DrawConceptSchema,
});

interface CoachCandidate {
  reply: string;
  visualization?: DrawConcept;
}

export async function draftCoachResponse(input: {
  session: CoachingSession;
  learner: LearnerSnapshot;
  settings: ExtensionSettings;
  signal?: AbortSignal;
}): Promise<CoachCandidate> {
  const { session, learner, settings } = input;
  const reasoning = reasoningPlanForProblem(session.problem, 'coach');
  const response = await requestModelResponse(
    settings,
    {
      instructions: SOCRATIC_COACH_SYSTEM_PROMPT,
      input: buildCoachInput(session, learner),
      tools: [drawConceptTool],
      tool_choice: 'auto',
      parallel_tool_calls: false,
      text: { verbosity: 'low' },
      max_output_tokens: reasoning.maxOutputTokens,
    },
    {
      signal: input.signal,
      model: reasoning.model,
      reasoningEffort: reasoning.effort,
      promptCacheKey: `socratic-coach:coach:${session.id}`,
    },
  );

  let visualization: DrawConcept | undefined;
  for (const item of response.output) {
    if (item.type !== 'function_call' || item.name !== 'draw_concept') continue;
    const parsed = DrawConceptSchema.safeParse(item.parsed_arguments);
    if (parsed.success) {
      visualization = parsed.data;
      break;
    }
  }

  const reply = response.output_text.trim() || visualization?.question;
  if (!reply) {
    throw new Error('The coach returned an empty response. Try again.');
  }

  return {
    reply,
    ...(visualization ? { visualization } : {}),
  };
}
