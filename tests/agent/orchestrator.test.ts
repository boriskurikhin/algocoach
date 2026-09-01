import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyLearnerProfile } from '../../src/learner/update-profile';
import {
  coachingMapFixture,
  problemFixture,
  sceneFixture,
  sessionFixture,
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
    mocks.analyze.mockResolvedValue(coachingMapFixture);
  });

  it('studies the problem before creating the learner-visible session', async () => {
    const onStatus = vi.fn();
    const { session, learnerSnapshot } = await startCoachingSession({
      problem: problemFixture,
      settings,
      onStatus,
    });

    expect(mocks.analyze).toHaveBeenCalledOnce();
    expect(session.coachingMap).toEqual(coachingMapFixture);
    expect(session.messages[0]?.content).toMatch(/what are you thinking/i);
    expect(learnerSnapshot.caveat).toMatch(/uncertain/i);
    expect(mocks.saveSession).toHaveBeenCalledWith(session);
    expect(onStatus).toHaveBeenCalledWith('studying', expect.any(String));
  });

  it('persists only the guarded reply and guarded profile evidence', async () => {
    mocks.getSession.mockResolvedValue(sessionFixture);
    mocks.draft.mockResolvedValue({
      reply: 'Candidate text',
      visualization: sceneFixture,
    });
    mocks.guard.mockResolvedValue({
      allowed: true,
      violations: ['none'],
      safeReply: 'What quantity should remain unchanged?',
      nextStage: 'clarify',
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
    });

    const { session, message } = await respondToLearner({
      sessionId: sessionFixture.id,
      content: 'I think the total should stay fixed.',
      settings,
    });

    expect(mocks.guard).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateReply: 'Candidate text',
        latestLearnerMessage: 'I think the total should stay fixed.',
      }),
    );
    expect(mocks.draft.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.guard.mock.invocationCallOrder[0]!,
    );
    expect(message.content).toBe('What quantity should remain unchanged?');
    expect(message.visualization).toEqual(sceneFixture);
    expect(session.stage).toBe('clarify');
    expect(session.messages.at(-1)).toEqual(message);
    expect(mocks.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        concepts: expect.objectContaining({ invariants: expect.any(Object) }),
      }),
    );
    expect(mocks.saveSession).toHaveBeenCalledTimes(2);
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
