import { z } from 'zod';
import {
  ChatMessageSchema,
  CoachStatusSchema,
  MAX_CHAT_MESSAGE_CHARS,
  MAX_SESSION_MESSAGES,
  type CoachingSession,
} from '../agent/schemas';
import { ActiveProblemResultSchema, ProblemContextSchema } from '../extraction/schema';
import { KnowledgeLevelSchema, LearnerProfileSchema } from '../learner/schema';
import { ExtensionSettingsSchema } from '../storage/local';

const sessionId = z.string().min(1).max(100);
const entryKey = z.string().trim().min(1).max(100);

const PublicSettingsSchema = z.object({ hasApiKey: z.boolean() });

const RestorableSessionSchema = z.object({
  sessionId,
  problem: ProblemContextSchema,
  completed: z.boolean(),
  messages: z.array(ChatMessageSchema).max(MAX_SESSION_MESSAGES),
});

export type RestorableSession = z.infer<typeof RestorableSessionSchema>;

export const toRestorableSession = (session: CoachingSession): RestorableSession => ({
  sessionId: session.id,
  problem: session.problem,
  completed: session.completed,
  messages: session.messages,
});

const ActiveSessionResultSchema = z.object({
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

const ProfileResultSchema = z.object({ profile: LearnerProfileSchema });
const EmptyResultSchema = z.null();

export type RuntimeRequest = z.infer<typeof RuntimeRequestSchema>;

export const RuntimeResultSchemas = {
  'settings:get': PublicSettingsSchema,
  'settings:save': PublicSettingsSchema,
  'settings:remove-key': PublicSettingsSchema,
  'settings:test-key': z.object({ connected: z.literal(true) }),
  'problem:extract': ActiveProblemResultSchema,
  'session:get-active': ActiveSessionResultSchema,
  'session:clear-active': EmptyResultSchema,
  'profile:get': ProfileResultSchema,
  'profile:set-enabled': ProfileResultSchema,
  'profile:reset': ProfileResultSchema,
  'profile:export': z.object({ json: z.string() }),
  'profile:remove-entry': ProfileResultSchema,
  'profile:set-knowledge': ProfileResultSchema,
} as const satisfies Record<RuntimeRequest['type'], z.ZodType>;

export type RuntimeResult<Type extends RuntimeRequest['type']> = z.infer<
  (typeof RuntimeResultSchemas)[Type]
>;

export const RuntimeResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string().min(1).max(1_000) }),
]);

export const CoachClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('coach:keepalive') }),
  z.object({ type: z.literal('coach:cancel') }),
  z.object({
    type: z.literal('session:start'),
    problem: ProblemContextSchema,
  }),
  z.object({
    type: z.literal('session:user-message'),
    sessionId,
    content: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_CHARS),
  }),
]);

export const CoachServerEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('coach:status'),
    status: CoachStatusSchema,
    label: z.string().max(200),
  }),
  RestorableSessionSchema.extend({ type: z.literal('session:ready') }),
  z.object({
    type: z.literal('coach:reply'),
    sessionId,
    message: ChatMessageSchema,
    completed: z.boolean(),
  }),
  z.object({ type: z.literal('coach:canceled') }),
  z.object({
    type: z.literal('coach:error'),
    message: z.string().min(1).max(1_000),
  }),
]);

export type RuntimeResponse = z.infer<typeof RuntimeResponseSchema>;
export type PublicSettings = z.infer<typeof PublicSettingsSchema>;
