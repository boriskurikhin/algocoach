import type { ProblemContext } from '../extraction/schema';
import type { LearnerSnapshot } from '../learner/schema';
import {
  buildLearnerSnapshot,
  applyProfileObservations,
} from '../learner/update-profile';
import { getLearnerProfile, saveLearnerProfile } from '../storage/local';
import type { ExtensionSettings } from '../storage/local';
import { getSession, saveSession } from '../storage/session';
import { analyzeProblem } from './problem-analysis';
import { draftCoachResponse } from './coach-response';
import { guardCoachResponse } from './response-gate';
import {
  ChatMessageSchema,
  CoachingSessionSchema,
  type ChatMessage,
  type CoachStatus,
  type CoachingSession,
} from './schemas';

export interface CoachingHooks {
  settings: ExtensionSettings;
  onStatus?: (status: CoachStatus, label: string) => void;
  onModelActivity?: () => void;
  signal?: AbortSignal;
}

const newId = (): string => crypto.randomUUID();

export async function startCoachingSession(
  input: CoachingHooks & { problem: ProblemContext },
): Promise<{ session: CoachingSession; learnerSnapshot: LearnerSnapshot }> {
  input.onStatus?.('studying', 'Studying the problem before we talk…');
  const profile = await getLearnerProfile();
  const learnerSnapshot = buildLearnerSnapshot(profile, [
    input.problem.title,
    ...input.problem.tags,
  ]);
  const coachingMap = await analyzeProblem(
    input.problem,
    learnerSnapshot,
    input.settings,
    input.onModelActivity,
    input.signal,
  );
  const now = Date.now();
  const opening = ChatMessageSchema.parse({
    id: newId(),
    role: 'assistant',
    content:
      `I’ve read “${input.problem.title}.” Before I offer any direction, ` +
      'what are you thinking so far, and where does your reasoning start to feel uncertain?',
    createdAt: now,
  });
  const session = CoachingSessionSchema.parse({
    version: 1,
    id: newId(),
    problemKey: input.problem.source.url,
    problem: input.problem,
    coachingMap,
    stage: 'listen',
    messages: [opening],
    createdAt: now,
    updatedAt: now,
  });
  await saveSession(session);
  return { session, learnerSnapshot };
}

export async function respondToLearner(
  input: CoachingHooks & { sessionId: string; content: string },
): Promise<{ session: CoachingSession; message: ChatMessage }> {
  const existing = await getSession(input.sessionId);
  if (!existing) {
    throw new Error('This coaching session expired. Start it again.');
  }

  const userMessage = ChatMessageSchema.parse({
    id: newId(),
    role: 'user',
    content: input.content,
    createdAt: Date.now(),
  });
  const withUser = CoachingSessionSchema.parse({
    ...existing,
    messages: [...existing.messages, userMessage].slice(-80),
    updatedAt: Date.now(),
  });
  await saveSession(withUser);

  const profile = await getLearnerProfile();
  const learnerSnapshot = buildLearnerSnapshot(profile, [
    withUser.problem.title,
    ...withUser.problem.tags,
    ...withUser.coachingMap.relevantConcepts,
  ]);

  input.onStatus?.('coaching', 'Choosing the smallest useful question…');
  const candidate = await draftCoachResponse(
    withUser,
    learnerSnapshot,
    input.settings,
    input.onModelActivity,
    input.signal,
  );

  input.onStatus?.('checking', 'Checking that the hint gives nothing away…');
  const guarded = await guardCoachResponse({
    stage: withUser.stage,
    latestLearnerMessage: userMessage.content,
    candidateReply: candidate.reply,
    ...(candidate.visualization ? { visualization: candidate.visualization } : {}),
    coachingMap: withUser.coachingMap,
    learner: learnerSnapshot,
    problemKey: withUser.problemKey,
    settings: input.settings,
    onActivity: input.onModelActivity,
    signal: input.signal,
  });

  input.onStatus?.('saving-profile', 'Remembering only useful learning signals…');
  const observations = guarded.profileObservations.map((observation) => ({
    ...observation,
    problemKey: observation.problemKey || withUser.problemKey,
  }));
  const updatedProfile = applyProfileObservations(profile, observations);
  await saveLearnerProfile(updatedProfile);

  const assistantMessage = ChatMessageSchema.parse({
    id: newId(),
    role: 'assistant',
    content: guarded.safeReply,
    createdAt: Date.now(),
    ...(guarded.allowVisualization && candidate.visualization
      ? { visualization: candidate.visualization }
      : {}),
  });
  const session = CoachingSessionSchema.parse({
    ...withUser,
    stage: guarded.nextStage,
    messages: [...withUser.messages, assistantMessage].slice(-80),
    updatedAt: Date.now(),
  });
  await saveSession(session);
  return { session, message: assistantMessage };
}
