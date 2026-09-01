import { z } from 'zod';

/** Retained evidence per estimate. Older notes are dropped, not summarized. */
export const MAX_EVIDENCE = 12;

export const SNAPSHOT_CAVEAT =
  'Estimates are uncertain and must not override current evidence.';

const EvidenceTypeSchema = z.enum(['self-reported', 'observed', 'demonstrated']);

export const KnowledgeLevelSchema = z.enum([
  'unknown',
  'encountered',
  'practicing',
  'reliable',
]);

const ProfileEvidenceSchema = z.object({
  id: z.string().min(1).max(100),
  at: z.number().int().nonnegative(),
  type: EvidenceTypeSchema,
  note: z.string().trim().min(1).max(300),
  problemKey: z.string().max(500).optional(),
  supports: z.boolean(),
});

const EstimateSchema = z.object({
  confidence: z.number().min(0).max(1),
  sampleCount: z.number().int().nonnegative(),
  lastObservedAt: z.number().int().nonnegative(),
  pinned: z.boolean().default(false),
  evidence: z.array(ProfileEvidenceSchema).max(MAX_EVIDENCE),
});

const KnowledgeEstimateSchema = EstimateSchema.extend({
  level: KnowledgeLevelSchema,
  demonstratedCount: z.number().int().nonnegative(),
});

const TendencyEstimateSchema = EstimateSchema.extend({
  score: z.number().min(-1).max(1),
});

export const LearnerProfileSchema = z.object({
  version: z.literal(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  personalizationEnabled: z.boolean(),
  languages: z.record(z.string(), KnowledgeEstimateSchema),
  concepts: z.record(z.string(), KnowledgeEstimateSchema),
  competencies: z.record(z.string(), KnowledgeEstimateSchema),
  blockers: z.record(z.string(), TendencyEstimateSchema),
  coachingPreferences: z.record(z.string(), TendencyEstimateSchema),
});

export const ProfileObservationSchema = z.object({
  dimension: z.enum([
    'language',
    'concept',
    'competency',
    'blocker',
    'coaching-preference',
  ]),
  key: z.string().trim().min(1).max(100),
  evidenceType: EvidenceTypeSchema,
  note: z.string().trim().min(1).max(300),
  supports: z.boolean(),
  confidence: z.number().min(0.05).max(1),
  knowledgeLevel: KnowledgeLevelSchema.nullable(),
  problemKey: z.string().max(500).nullable(),
});

export const LearnerSnapshotSchema = z.object({
  preferredLanguages: z.array(z.string()).max(5),
  reliableConcepts: z.array(z.string()).max(20),
  practicingConcepts: z.array(z.string()).max(20),
  strengths: z.array(z.string()).max(12),
  recurringBlockers: z.array(z.string()).max(12),
  helpfulCoachingStyles: z.array(z.string()).max(8),
  coachingPressure: z.enum(['gentle', 'standard', 'firm']),
  caveat: z.literal(SNAPSHOT_CAVEAT),
});

export type LearnerProfile = z.infer<typeof LearnerProfileSchema>;
export type ProfileEvidence = z.infer<typeof ProfileEvidenceSchema>;
export type ProfileObservation = z.input<typeof ProfileObservationSchema>;
export type LearnerSnapshot = z.infer<typeof LearnerSnapshotSchema>;
export type KnowledgeEstimate = z.infer<typeof KnowledgeEstimateSchema>;
export type TendencyEstimate = z.infer<typeof TendencyEstimateSchema>;
export type KnowledgeLevel = z.infer<typeof KnowledgeLevelSchema>;
