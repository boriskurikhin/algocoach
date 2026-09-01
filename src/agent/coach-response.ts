import { zodResponsesFunction } from 'openai/helpers/zod';
import type { LearnerSnapshot } from '../learner/schema';
import { SOCRATIC_COACH_SYSTEM_PROMPT, buildCoachInput } from '../prompts/coach';
import type { ExtensionSettings } from '../storage/local';
import { DrawConceptSchema, type DrawConcept } from '../visualization/schema';
import { requestModelResponse } from './openai-client';
import type { CoachingSession } from './schemas';

const drawConceptTool = zodResponsesFunction({
  name: 'draw_concept',
  description:
    'Draw one minimal, prediction-oriented concept at the current hint stage. Never show the full solution.',
  parameters: DrawConceptSchema,
});

export interface CoachCandidate {
  reply: string;
  visualization?: DrawConcept;
}

export async function draftCoachResponse(
  session: CoachingSession,
  learner: LearnerSnapshot,
  settings: ExtensionSettings,
  onActivity?: () => void,
  signal?: AbortSignal,
): Promise<CoachCandidate> {
  const response = await requestModelResponse(
    settings,
    onActivity,
    {
      instructions: SOCRATIC_COACH_SYSTEM_PROMPT,
      input: buildCoachInput(session, learner),
      tools: [drawConceptTool],
      tool_choice: 'auto',
      parallel_tool_calls: false,
      text: { verbosity: 'low' },
      max_output_tokens: 12_000,
    },
    { signal },
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

  const reply =
    response.output_text.trim() ||
    visualization?.question ||
    'What do you predict should happen in the smallest example?';

  return {
    reply,
    ...(visualization ? { visualization } : {}),
  };
}
