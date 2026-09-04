import type { ProblemContext } from '../extraction/schema';
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
  COACH_STATUS_LABELS,
  CoachingSessionSchema,
  MAX_SESSION_MESSAGES,
  type ChatMessage,
  type CoachStatus,
  type CoachingSession,
} from './schemas';

interface CoachingHooks {
  settings: ExtensionSettings;
  onStatus?: (status: CoachStatus, label: string) => void;
  signal?: AbortSignal;
}

const newId = (): string => crypto.randomUUID();

const roundedCodeforcesRating = (rating: number): number =>
  Math.min(4_000, Math.max(800, Math.round(rating / 100) * 100));

export async function startCoachingSession(
  input: CoachingHooks & { problem: ProblemContext },
): Promise<CoachingSession> {
  const startedAt = Date.now();
  input.onStatus?.('studying', COACH_STATUS_LABELS.studying);
  const profile = await getLearnerProfile();
  const learnerSnapshot = buildLearnerSnapshot(profile, [
    input.problem.title,
    ...input.problem.tags,
  ]);
  const analysis = await analyzeProblem({
    problem: input.problem,
    learner: learnerSnapshot,
    settings: input.settings,
    signal: input.signal,
  });
  const coachingMap = analysis.coachingMap;
  const officialRating =
    input.problem.codeforcesRating?.source === 'official'
      ? input.problem.codeforcesRating
      : null;
  const problem: ProblemContext = {
    ...input.problem,
    codeforcesRating:
      officialRating ??
      ({
        value: roundedCodeforcesRating(analysis.estimatedCodeforcesRating),
        source: 'estimated',
      } as const),
  };
  const now = Date.now();
  const opening = ChatMessageSchema.parse({
    id: newId(),
    role: 'assistant',
    content:
      `I’ve read “${problem.title}.” What would you like to accomplish in this ` +
      'session? We can clarify the problem, talk through your current thinking, ' +
      'pressure-test an approach, or debug code together. Share whatever you ' +
      'have so far, or tell me you’re starting fresh.',
    createdAt: now,
  });
  const session = CoachingSessionSchema.parse({
    version: 2,
    id: newId(),
    problemKey: problem.source.url,
    problem,
    coachingMap,
    completed: false,
    messages: [opening],
    createdAt: startedAt,
    updatedAt: now,
  });
  return saveSession(session);
}

export async function respondToLearner(
  input: CoachingHooks & { sessionId: string; content: string },
): Promise<{ session: CoachingSession; message: ChatMessage }> {
  const existing = await getSession(input.sessionId);
  if (!existing) {
    throw new Error('This coaching session expired. Start it again.');
  }
  if (existing.completed) {
    throw new Error(
      'This coaching session is complete. Choose another problem to keep practicing.',
    );
  }

  const userMessage = ChatMessageSchema.parse({
    id: newId(),
    role: 'user',
    content: input.content,
    createdAt: Date.now(),
  });
  const withUser = CoachingSessionSchema.parse({
    ...existing,
    messages: [...existing.messages, userMessage].slice(-MAX_SESSION_MESSAGES),
    updatedAt: Date.now(),
  });
  await saveSession(withUser);

  const profile = await getLearnerProfile();
  const learnerSnapshot = buildLearnerSnapshot(profile, [
    withUser.problem.title,
    ...withUser.problem.tags,
    ...withUser.coachingMap.relevantConcepts,
  ]);

  input.onStatus?.('coaching', COACH_STATUS_LABELS.coaching);
  const candidate = await draftCoachResponse({
    session: withUser,
    learner: learnerSnapshot,
    settings: input.settings,
    signal: input.signal,
  });

  input.onStatus?.('checking', COACH_STATUS_LABELS.checking);
  const guarded = await guardCoachResponse({
    sessionId: withUser.id,
    latestLearnerMessage: userMessage.content,
    candidateReply: candidate.reply,
    ...(candidate.visualization ? { visualization: candidate.visualization } : {}),
    coachingMap: withUser.coachingMap,
    learner: learnerSnapshot,
    problemKey: withUser.problemKey,
    ...(withUser.problem.codeforcesRating
      ? { codeforcesRating: withUser.problem.codeforcesRating.value }
      : {}),
    conversation: withUser.messages,
    settings: input.settings,
    signal: input.signal,
  });

  if (profile.personalizationEnabled && guarded.profileObservations.length > 0) {
    await saveLearnerProfile(
      applyProfileObservations(
        profile,
        guarded.profileObservations.map((observation) => ({
          ...observation,
          problemKey: observation.problemKey || withUser.problemKey,
        })),
      ),
    );
  }

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
    completed: guarded.solutionStatus === 'optimal',
    messages: [...withUser.messages, assistantMessage].slice(-MAX_SESSION_MESSAGES),
    updatedAt: Date.now(),
  });
  await saveSession(session);
  return { session, message: assistantMessage };
}
