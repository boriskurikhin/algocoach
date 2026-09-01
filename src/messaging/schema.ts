import { z } from 'zod';
import {
  ChatMessageSchema,
  CoachStageSchema,
  CoachStatusSchema,
} from '../agent/schemas';
import { ProblemContextSchema } from '../extraction/schema';
import { KnowledgeLevelSchema, LearnerSnapshotSchema } from '../learner/schema';
import { ExtensionSettingsSchema } from '../storage/local';

const sessionId = z.string().min(1).max(100);
const entryKey = z.string().trim().min(1).max(100);

export const PublicSettingsSchema = ExtensionSettingsSchema.omit({
  apiKey: true,
}).extend({
  hasApiKey: z.boolean(),
});

const RestorableSessionSchema = z.object({
  sessionId,
  problem: ProblemContextSchema,
  stage: CoachStageSchema,
  messages: z.array(ChatMessageSchema).max(80),
});

export const ActiveSessionResultSchema = z.object({
  session: RestorableSessionSchema.nullable(),
});

export const RuntimeRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('settings:get') }),
  z.object({
    type: z.literal('settings:save'),
    settings: ExtensionSettingsSchema.partial(),
  }),
  z.object({ type: z.literal('settings:remove-key') }),
  z.object({ type: z.literal('settings:test-key') }),
  z.object({ type: z.literal('problem:extract') }),
  z.object({ type: z.literal('session:get-active') }),
  z.object({
    type: z.literal('session:clear-active'),
    sessionId,
  }),
  z.object({ type: z.literal('profile:get') }),
  z.object({
    type: z.literal('profile:set-enabled'),
    enabled: z.boolean(),
  }),
  z.object({ type: z.literal('profile:reset') }),
  z.object({ type: z.literal('profile:export') }),
  z.object({
    type: z.literal('profile:remove-entry'),
    dimension: z.enum([
      'languages',
      'concepts',
      'competencies',
      'blockers',
      'coachingPreferences',
    ]),
    key: entryKey,
  }),
  z.object({
    type: z.literal('profile:set-knowledge'),
    dimension: z.enum(['languages', 'concepts', 'competencies']),
    key: entryKey,
    level: KnowledgeLevelSchema,
    pinned: z.boolean(),
  }),
]);

export const RuntimeResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown().optional() }),
  z.object({ ok: z.literal(false), error: z.string().min(1).max(1_000) }),
]);

export const CoachClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('coach:keepalive') }),
  z.object({
    type: z.literal('session:start'),
    problem: ProblemContextSchema,
  }),
  z.object({
    type: z.literal('session:user-message'),
    sessionId,
    content: z.string().trim().min(1).max(30_000),
  }),
]);

export const CoachServerEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('coach:status'),
    status: CoachStatusSchema,
    label: z.string().max(200),
  }),
  z.object({
    type: z.literal('session:ready'),
    sessionId,
    problem: ProblemContextSchema,
    stage: CoachStageSchema,
    messages: z.array(ChatMessageSchema).max(80),
    learnerSnapshot: LearnerSnapshotSchema,
  }),
  z.object({
    type: z.literal('coach:chunk'),
    sessionId,
    chunk: z.string().max(500),
  }),
  z.object({
    type: z.literal('coach:reply'),
    sessionId,
    message: ChatMessageSchema,
    stage: CoachStageSchema,
  }),
  z.object({
    type: z.literal('coach:error'),
    message: z.string().min(1).max(1_000),
  }),
]);

export type RuntimeRequest = z.infer<typeof RuntimeRequestSchema>;
export type RuntimeResponse = z.infer<typeof RuntimeResponseSchema>;
export type PublicSettings = z.infer<typeof PublicSettingsSchema>;
