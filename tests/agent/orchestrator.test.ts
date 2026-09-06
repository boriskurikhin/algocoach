import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COACH_STATUS_LABELS } from '../../src/agent/schemas';
import { createEmptyLearnerProfile } from '../../src/learner/update-profile';
import {
  coachingMapFixture,
  problemAnalysisFixture,
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

const settings = { apiKey: 'test-key' };

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
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValue(500);
    const session = await startCoachingSession({
      problem: problemFixture,
      settings,
      onStatus,
    }).finally(() => now.mockRestore());

    expect(mocks.analyze).toHaveBeenCalledOnce();
    expect(session.coachingMap).toEqual(coachingMapFixture);
    expect(session.problem.codeforcesRating).toEqual({
      value: 1_300,
      source: 'estimated',
    });
    expect(session.messages[0]?.content).toContain(problemFixture.title);
    expect(session.messages[0]?.content).toMatch(/what would you like to accomplish/i);
    expect(session.messages[0]?.content).toMatch(/clarify|pressure-test|debug/i);
    expect(session.messages[0]?.content).toMatch(/starting fresh/i);
    expect(session.createdAt).toBe(100);
    expect(session.messages[0]?.createdAt).toBe(500);
    expect(session.updatedAt).toBe(500);
    expect(mocks.analyze).toHaveBeenCalledWith({
      problem: problemFixture,
      learner: expect.objectContaining({ caveat: expect.stringMatching(/uncertain/i) }),
      settings,
      signal: undefined,
    });
    expect(mocks.saveSession).toHaveBeenCalledWith(session);
    expect(onStatus).toHaveBeenCalledWith('studying', COACH_STATUS_LABELS.studying);
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
    mocks.draft.mockResolvedValue({
      reply: 'Candidate text',
      visualization: sceneFixture,
    });
    mocks.guard.mockResolvedValue({
      safeReply: 'What quantity should remain unchanged?',
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
        codeforcesRating: 1_300,
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
    expect(session.completed).toBe(false);
    expect(session.messages.at(-1)).toEqual(message);
    expect(mocks.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        concepts: expect.objectContaining({ invariants: expect.any(Object) }),
      }),
    );
    expect(mocks.saveSession).toHaveBeenCalledTimes(2);
  });

  it('returns the guarded reply when optional profile persistence fails', async () => {
    mocks.getSession.mockResolvedValue(sessionFixture);
    mocks.draft.mockResolvedValue({ reply: 'Candidate text' });
    mocks.guard.mockResolvedValue({
      safeReply: 'Trace the smallest case first.',
      solutionStatus: 'in-progress',
      allowVisualization: false,
      profileObservations: [
        {
          dimension: 'concept',
          key: 'invariants',
          evidenceType: 'observed',
          note: 'The learner attempted to state an invariant.',
          supports: true,
          confidence: 0.7,
          knowledgeLevel: 'practicing',
          problemKey: null,
        },
      ],
    });
    mocks.saveProfile.mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));

    const { session, message } = await respondToLearner({
      sessionId: sessionFixture.id,
      content: 'I think this value stays fixed.',
      settings,
    });

    expect(message.content).toBe('Trace the smallest case first.');
    expect(session.messages.at(-1)).toEqual(message);
    expect(mocks.saveSession).toHaveBeenCalledTimes(2);
  });

  it('persists an optimal solution as a completed terminal session', async () => {
    mocks.getSession.mockResolvedValue(sessionFixture);
    mocks.draft.mockResolvedValue({
      reply: 'Yes, that is optimal.',
      visualization: sceneFixture,
    });
    mocks.guard.mockResolvedValue({
      safeReply:
        'Yes — you’ve arrived at an optimal solution. This coaching session is complete.',
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

    expect(session.completed).toBe(true);
    expect(message.content).toMatch(/optimal solution/i);
    expect(message.visualization).toBeUndefined();
    expect(mocks.saveSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ completed: true }),
    );
  });

  it('rejects further messages after the session is complete', async () => {
    mocks.getSession.mockResolvedValue({
      ...sessionFixture,
      completed: true,
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

  it('keeps the learner message when a model step fails', async () => {
    mocks.getSession.mockResolvedValue(sessionFixture);
    mocks.draft.mockRejectedValueOnce(new Error('Coach connection failed.'));

    await expect(
      respondToLearner({
        sessionId: sessionFixture.id,
        content: 'I traced the smallest case.',
        settings,
      }),
    ).rejects.toThrow('Coach connection failed.');

    expect(mocks.saveSession).toHaveBeenCalledOnce();
    expect(mocks.saveSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'I traced the smallest case.',
          }),
        ]),
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
