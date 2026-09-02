import { z } from 'zod';
import {
  CodeforcesRatingValueSchema,
  ProblemContextSchema,
} from '../extraction/schema';
import { ProfileObservationSchema } from '../learner/schema';
import { DrawConceptSchema } from '../visualization/schema';
import { EMPTY_SESSION_USAGE, SessionUsageSchema } from './usage';

export const OPENAI_CONNECTION_TIMEOUT_MS = 10 * 60_000;
export const PROBLEM_ANALYSIS_MAX_OUTPUT_TOKENS = 64_000;
export const COACH_RESPONSE_MAX_OUTPUT_TOKENS = 48_000;
export const RESPONSE_GUARD_MAX_OUTPUT_TOKENS = 24_000;
export const COACH_PROCESSING_TIER = 'default' as const;
export const COACH_PROCESSING_LABEL = 'Standard';

const shortId = z.string().min(1).max(100);

const hintStages = [
  'listen',
  'clarify',
  'concretize',
  'contradiction',
  'boundary',
  'connect',
] as const;

export const HintStageSchema = z.enum(hintStages);
export const CoachStageSchema = z.enum([...hintStages, 'complete']);

export const CoachStatusSchema = z.enum([
  'studying',
  'coaching',
  'checking',
  'saving-profile',
]);

export const CoachingMapSchema = z.object({
  problemSummary: z.string().min(1).max(1_000),
  solutionFamilies: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        coreIdea: z.string().min(1).max(800),
        invariant: z.string().min(1).max(800),
        complexity: z.string().min(1).max(300),
      }),
    )
    .min(1)
    .max(1),
  canonicalFamily: z.string().min(1).max(200),
  edgeCases: z.array(z.string().min(1).max(300)).max(6),
  likelyMisconceptions: z.array(z.string().min(1).max(300)).max(6),
  relevantConcepts: z.array(z.string().min(1).max(100)).max(12),
  hintLadder: z
    .array(
      z.object({
        stage: HintStageSchema,
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
  content: z.string().min(1).max(30_000),
  createdAt: z.number().int().nonnegative(),
  visualization: DrawConceptSchema.optional(),
});

export const CoachingSessionSchema = z.object({
  version: z.literal(1),
  id: shortId,
  problemKey: z.string().min(1).max(4_000),
  problem: ProblemContextSchema,
  coachingMap: CoachingMapSchema,
  stage: CoachStageSchema,
  messages: z.array(ChatMessageSchema).max(80),
  usage: SessionUsageSchema.default(() => ({ ...EMPTY_SESSION_USAGE })),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const GuardViolationSchema = z.enum([
  'complete-code',
  'answer-shaped-pseudocode',
  'passing-rewrite',
  'premature-algorithm',
  'overpowered-hint',
  'answer-revealing-visualization',
  'multiple-interventions',
  'overloaded-explanation',
  'unearned-abstraction',
  'cluttered-visualization',
  'patronizing-tone',
  'unsupported-learner-label',
  'none',
]);

export const GuardResultSchema = z.object({
  allowed: z.boolean(),
  violations: z.array(GuardViolationSchema).max(10),
  safeReply: z.string().min(1).max(5_000),
  nextStage: CoachStageSchema,
  solutionStatus: z.enum(['in-progress', 'optimal']),
  allowVisualization: z.boolean(),
  profileObservations: z.array(ProfileObservationSchema).max(8),
});

export type CoachingMap = z.infer<typeof CoachingMapSchema>;
export type ProblemAnalysis = z.infer<typeof ProblemAnalysisSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type CoachingSession = z.infer<typeof CoachingSessionSchema>;
export type GuardResult = z.infer<typeof GuardResultSchema>;
export type CoachStage = z.infer<typeof CoachStageSchema>;
export type HintStage = z.infer<typeof HintStageSchema>;
export type CoachStatus = z.infer<typeof CoachStatusSchema>;
