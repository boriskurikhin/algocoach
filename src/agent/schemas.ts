import { z } from 'zod';
import {
  CodeforcesRatingValueSchema,
  ProblemContextSchema,
} from '../extraction/schema';
import { ProfileObservationSchema } from '../learner/schema';
import { DrawConceptSchema } from '../visualization/schema';

export const OPENAI_CONNECTION_TIMEOUT_MS = 10 * 60_000;
export const PROBLEM_ANALYSIS_MAX_OUTPUT_TOKENS = 64_000;
export const COACH_RESPONSE_MAX_OUTPUT_TOKENS = 48_000;
export const RESPONSE_GUARD_MAX_OUTPUT_TOKENS = 24_000;
export const COACH_PROCESSING_TIER = 'default' as const;
export const MAX_CHAT_MESSAGE_CHARS = 30_000;
export const MAX_SESSION_MESSAGES = 80;

const shortId = z.string().min(1).max(100);

export const CoachStatusSchema = z.enum(['studying', 'coaching', 'checking']);

export const COACH_STATUS_LABELS = {
  studying: 'Studying the problem before we talk…',
  coaching: 'Thinking through what would help next…',
  checking: 'Checking that the key work stays with you…',
} as const satisfies Record<z.infer<typeof CoachStatusSchema>, string>;

const CoachingMapSchema = z.object({
  problemSummary: z.string().min(1).max(1_000),
  solution: z.object({
    name: z.string().min(1).max(200),
    coreIdea: z.string().min(1).max(800),
    invariant: z.string().min(1).max(800),
    complexity: z.string().min(1).max(300),
  }),
  edgeCases: z.array(z.string().min(1).max(300)).max(6),
  likelyMisconceptions: z.array(z.string().min(1).max(300)).max(6),
  relevantConcepts: z.array(z.string().min(1).max(100)).max(12),
  hintLadder: z
    .array(
      z.object({
        diagnosticQuestion: z.string().min(1).max(500),
        safeNudge: z.string().min(1).max(500),
      }),
    )
    .min(3)
    .max(6),
  visualizationOpportunities: z.array(z.string().min(1).max(200)).max(3),
});

export const ProblemAnalysisSchema = z.object({
  coachingMap: CoachingMapSchema,
  estimatedCodeforcesRating: CodeforcesRatingValueSchema,
});

export const ChatMessageSchema = z.object({
  id: shortId,
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(MAX_CHAT_MESSAGE_CHARS),
  createdAt: z.number().int().nonnegative(),
  visualization: DrawConceptSchema.optional(),
});

const CoachingSessionDataSchema = z.object({
  version: z.literal(2),
  id: shortId,
  problemKey: z.string().min(1).max(4_000),
  problem: ProblemContextSchema,
  coachingMap: CoachingMapSchema,
  completed: z.boolean(),
  messages: z.array(ChatMessageSchema).max(MAX_SESSION_MESSAGES),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const CoachingSessionSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const migrated: Record<string, unknown> = { ...value };
  if (migrated.version === 1 && typeof migrated.stage === 'string') {
    migrated.version = 2;
    migrated.completed = migrated.stage === 'complete';
  }
  if (
    migrated.coachingMap &&
    typeof migrated.coachingMap === 'object' &&
    !Array.isArray(migrated.coachingMap) &&
    !('solution' in migrated.coachingMap) &&
    'solutionFamilies' in migrated.coachingMap &&
    Array.isArray(migrated.coachingMap.solutionFamilies)
  ) {
    migrated.coachingMap = {
      ...migrated.coachingMap,
      solution: migrated.coachingMap.solutionFamilies[0],
    };
  }
  return migrated;
}, CoachingSessionDataSchema);

export const GuardResultSchema = z.object({
  safeReply: z.string().min(1).max(5_000),
  solutionStatus: z.enum(['in-progress', 'optimal']),
  allowVisualization: z.boolean(),
  profileObservations: z.array(ProfileObservationSchema).max(8),
});

export type CoachingMap = z.infer<typeof CoachingMapSchema>;
export type ProblemAnalysis = z.infer<typeof ProblemAnalysisSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type CoachingSession = z.infer<typeof CoachingSessionSchema>;
export type GuardResult = z.infer<typeof GuardResultSchema>;
export type CoachStatus = z.infer<typeof CoachStatusSchema>;
