import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyLearnerProfile } from '../../src/learner/update-profile';
import {
  coachingMapFixture,
  problemAnalysisFixture,
  problemFixture,
  sceneFixture,
  sessionFixture,
  sessionUsageFixture,
} from '../fixtures/domain';

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  draft: vi.fn(),
  guard: vi.fn(),
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
  getSession: vi.fn(),
  saveSession: vi.fn(),
}));

vi.mock('../../src/agent/problem-analysis', () => ({
  analyzeProblem: mocks.analyze,
}));
vi.mock('../../src/agent/coach-response', () => ({
  draftCoachResponse: mocks.draft,
}));
vi.mock('../../src/agent/response-gate', () => ({
  guardCoachResponse: mocks.guard,
}));
vi.mock('../../src/storage/local', () => ({
  getLearnerProfile: mocks.getProfile,
  saveLearnerProfile: mocks.saveProfile,
}));
vi.mock('../../src/storage/session', () => ({
  getSession: mocks.getSession,
  saveSession: mocks.saveSession,
}));

import { respondToLearner, startCoachingSession } from '../../src/agent/orchestrator';

const settings = {
  apiKey: 'test-key',
  model: 'gpt-5.6-sol' as const,
  reasoningEffort: 'high' as const,
  reasoningMode: 'standard' as const,
};

describe('coaching orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProfile.mockResolvedValue(createEmptyLearnerProfile(1));
    mocks.saveProfile.mockImplementation(async (profile) => profile);
    mocks.saveSession.mockImplementation(async (session) => session);
    mocks.analyze.mockResolvedValue(problemAnalysisFixture);
  });

  it('studies the problem before creating the learner-visible session', async () => {
    const onStatus = vi.fn();
    mocks.analyze.mockImplementationOnce(async (...args: unknown[]) => {
      const recordUsage = args[5] as (usage: typeof sessionUsageFixture) => void;
      recordUsage(sessionUsageFixture);
      return problemAnalysisFixture;
    });
    const session = await startCoachingSession({
      problem: problemFixture,
      settings,
      onStatus,
    });

    expect(mocks.analyze).toHaveBeenCalledOnce();
    expect(session.coachingMap).toEqual(coachingMapFixture);
    expect(session.problem.codeforcesRating).toEqual({
      value: 1_300,
      source: 'estimated',
    });
    expect(session.messages[0]?.content).toMatch(/smallest example/i);
    expect(mocks.analyze).toHaveBeenCalledWith(
      problemFixture,
      expect.objectContaining({ caveat: expect.stringMatching(/uncertain/i) }),
      settings,
      undefined,
      undefined,
      expect.any(Function),
    );
    expect(session.usage).toEqual(sessionUsageFixture);
    expect(mocks.saveSession).toHaveBeenCalledWith(session);
    expect(onStatus).toHaveBeenCalledWith('studying', expect.any(String));
  });

  it('keeps an official Codeforces rating instead of the model estimate', async () => {
    const officialProblem = {
      ...problemFixture,
      source: {
        ...problemFixture.source,
        site: 'codeforces' as const,
      },
      rating: '*2100',
      codeforcesRating: {
        value: 2_100,
        source: 'official' as const,
      },
    };
    mocks.analyze.mockResolvedValueOnce({
      ...problemAnalysisFixture,
      estimatedCodeforcesRating: 2_600,
    });

    const session = await startCoachingSession({
      problem: officialProblem,
      settings,
    });

    expect(session.problem.codeforcesRating).toEqual({
      value: 2_100,
      source: 'official',
    });
  });

  it('persists only the guarded reply and guarded profile evidence', async () => {
    mocks.getSession.mockResolvedValue(sessionFixture);
    mocks.draft.mockImplementation(async (...args: unknown[]) => {
      const recordUsage = args[5] as (usage: typeof sessionUsageFixture) => void;
      recordUsage(sessionUsageFixture);
      return {
        reply: 'Candidate text',
        visualization: sceneFixture,
      };
    });
    mocks.guard.mockImplementation(async (guardInput) => {
      guardInput.onUsage(sessionUsageFixture);
      return {
        allowed: true,
        violations: ['none'],
        safeReply: 'What quantity should remain unchanged?',
        nextStage: 'clarify',
        solutionStatus: 'in-progress',
        allowVisualization: true,
        profileObservations: [
          {
            dimension: 'concept',
            key: 'invariants',
            evidenceType: 'demonstrated',
            note: 'The learner stated a candidate invariant.',
            supports: true,
            confidence: 0.8,
            knowledgeLevel: 'practicing',
            problemKey: null,
          },
        ],
      };
    });

    const { session, message } = await respondToLearner({
      sessionId: sessionFixture.id,
      content: 'I think the total should stay fixed.',
      settings,
    });

    expect(mocks.guard).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: sessionFixture.id,
        candidateReply: 'Candidate text',
        latestLearnerMessage: 'I think the total should stay fixed.',
        conversation: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'I think the total should stay fixed.',
          }),
        ]),
      }),
    );
    expect(mocks.draft.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.guard.mock.invocationCallOrder[0]!,
    );
    expect(message.content).toBe('What quantity should remain unchanged?');
    expect(message.visualization).toEqual(sceneFixture);
    expect(session.stage).toBe('clarify');
    expect(session.messages.at(-1)).toEqual(message);
    expect(session.usage.modelCalls).toBe(3);
    expect(session.usage.estimatedCostUsd).toBeCloseTo(
      sessionUsageFixture.estimatedCostUsd * 3,
    );
    expect(mocks.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        concepts: expect.objectContaining({ invariants: expect.any(Object) }),
      }),
    );
    expect(mocks.saveSession).toHaveBeenCalledTimes(2);
  });

  it('persists an optimal solution as a completed terminal session', async () => {
    mocks.getSession.mockResolvedValue(sessionFixture);
    mocks.draft.mockResolvedValue({
      reply: 'Yes, that is optimal.',
      visualization: sceneFixture,
    });
    mocks.guard.mockResolvedValue({
      allowed: true,
      violations: ['none'],
      safeReply:
        'Yes — you’ve arrived at an optimal solution. This coaching session is complete.',
      nextStage: 'complete',
      solutionStatus: 'optimal',
      allowVisualization: false,
      profileObservations: [],
    });

    const { session, message } = await respondToLearner({
      sessionId: sessionFixture.id,
      content:
        'Each conversion is processed once while I preserve surplus, so this is linear.',
      settings,
    });

    expect(session.stage).toBe('complete');
    expect(message.content).toMatch(/optimal solution/i);
    expect(message.visualization).toBeUndefined();
    expect(mocks.saveSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ stage: 'complete' }),
    );
  });

  it('rejects further messages after the session is complete', async () => {
    mocks.getSession.mockResolvedValue({
      ...sessionFixture,
      stage: 'complete',
    });

    await expect(
      respondToLearner({
        sessionId: sessionFixture.id,
        content: 'Can I ask one more question?',
        settings,
      }),
    ).rejects.toThrow(/session is complete/i);

    expect(mocks.draft).not.toHaveBeenCalled();
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.saveSession).not.toHaveBeenCalled();
  });

  it('keeps billable usage when a model step fails after reporting it', async () => {
    mocks.getSession.mockResolvedValue(sessionFixture);
    mocks.draft.mockImplementationOnce(async (...args: unknown[]) => {
      const recordUsage = args[5] as (usage: typeof sessionUsageFixture) => void;
      recordUsage(sessionUsageFixture);
      throw new Error('Guard connection failed.');
    });

    await expect(
      respondToLearner({
        sessionId: sessionFixture.id,
        content: 'I traced the smallest case.',
        settings,
      }),
    ).rejects.toThrow('Guard connection failed.');

    expect(mocks.saveSession).toHaveBeenCalledTimes(2);
    expect(mocks.saveSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({ modelCalls: 2 }),
      }),
    );
  });

  it('rejects expired sessions before calling either model', async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(
      respondToLearner({
        sessionId: 'missing',
        content: 'hello',
        settings,
      }),
    ).rejects.toThrow(/expired/i);
    expect(mocks.draft).not.toHaveBeenCalled();
    expect(mocks.guard).not.toHaveBeenCalled();
  });
});
