import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  coachingMapFixture,
  learnerSnapshotFixture,
  sceneFixture,
} from '../fixtures/domain';
import {
  resetResponseMocks,
  settingsFixture as settings,
  stubOpenAI,
} from '../fixtures/openai';

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
}));

vi.mock('openai', (importOriginal) => stubOpenAI(mocks, importOriginal));

import {
  guardCoachResponse,
  hasObviousSolutionLeak,
} from '../../src/agent/response-gate';

describe('response gate', () => {
  beforeEach(() => {
    resetResponseMocks(mocks);
    mocks.parse.mockResolvedValue({
      output_parsed: {
        allowed: true,
        violations: ['none'],
        safeReply: 'What should remain true after one batch?',
        nextStage: 'connect',
        solutionStatus: 'in-progress',
        allowVisualization: true,
        profileObservations: [],
      },
    });
  });

  it('recognizes obvious code and pseudocode leaks locally', () => {
    expect(
      hasObviousSolutionLeak(
        "Here's the complete code:\n```python\n" +
          'print("answer")\n'.repeat(12) +
          '```',
      ),
    ).toBe(true);
    expect(
      hasObviousSolutionLeak('for each node\n  update the distance\n  return distance'),
    ).toBe(true);
    expect(
      hasObviousSolutionLeak('What does your distance variable mean at this point?'),
    ).toBe(false);
    expect(
      hasObviousSolutionLeak(
        'This line only consumes existing stock:\n```python\nleftovers[item] -= used\n```',
      ),
    ).toBe(false);
    expect(hasObviousSolutionLeak('```python\ndef solve():\n    return 1\n```')).toBe(
      true,
    );
    expect(hasObviousSolutionLeak('```python\nunfinished')).toBe(true);
  });

  it('prevents a gate from skipping hint stages', async () => {
    const guarded = await guardCoachResponse({
      sessionId: 'session-1',
      stage: 'listen',
      latestLearnerMessage: 'I think I should round up.',
      candidateReply: 'What happens to the extra unit?',
      visualization: sceneFixture,
      coachingMap: coachingMapFixture,
      learner: learnerSnapshotFixture,
      problemKey: 'problem',
      conversation: [],
      settings,
    });

    expect(guarded.nextStage).toBe('clarify');
    expect(guarded.allowVisualization).toBe(true);
    const request = mocks.parse.mock.calls[0]?.[0];
    expect(request.store).toBe(false);
    expect(request.service_tier).toBe('default');
    expect(request.prompt_cache_key).toBe('socratic-coach:guard:session-1');
    expect(request.prompt_cache_options).toEqual({ mode: 'implicit', ttl: '30m' });
    expect(request.text.verbosity).toBe('low');
    expect(request.max_output_tokens).toBe(24_000);
  });

  it('does not silently regress the hint stage', async () => {
    mocks.parse.mockResolvedValueOnce({
      output_parsed: {
        allowed: true,
        violations: ['none'],
        safeReply: 'What boundary case challenges that invariant?',
        nextStage: 'listen',
        solutionStatus: 'in-progress',
        allowVisualization: false,
        profileObservations: [],
      },
    });

    const guarded = await guardCoachResponse({
      sessionId: 'session-1',
      stage: 'boundary',
      latestLearnerMessage: 'My invariant fails on an empty input.',
      candidateReply: 'What boundary case challenges that invariant?',
      coachingMap: coachingMapFixture,
      learner: learnerSnapshotFixture,
      problemKey: 'problem',
      conversation: [],
      settings,
    });

    expect(guarded.nextStage).toBe('boundary');
  });

  it('drops visuals whenever the candidate needed rewriting', async () => {
    mocks.parse.mockResolvedValueOnce({
      output_parsed: {
        allowed: false,
        violations: ['answer-revealing-visualization'],
        safeReply: 'Can you trace one edge before drawing the whole graph?',
        nextStage: 'clarify',
        solutionStatus: 'in-progress',
        allowVisualization: true,
        profileObservations: [],
      },
    });

    const guarded = await guardCoachResponse({
      sessionId: 'session-1',
      stage: 'listen',
      latestLearnerMessage: 'Show me the full graph traversal.',
      candidateReply: 'Trace every edge like this.',
      visualization: sceneFixture,
      coachingMap: coachingMapFixture,
      learner: learnerSnapshotFixture,
      problemKey: 'problem',
      conversation: [],
      settings,
    });

    expect(guarded.allowVisualization).toBe(false);
  });

  it('drops a structurally valid visual when it is too dense for one teaching move', async () => {
    const guarded = await guardCoachResponse({
      sessionId: 'session-1',
      stage: 'listen',
      latestLearnerMessage: 'Can we look at one small case?',
      candidateReply: 'Track what changes in this case.',
      visualization: {
        ...sceneFixture,
        frames: Array.from({ length: 7 }, () => sceneFixture.frames[0]!),
      },
      coachingMap: coachingMapFixture,
      learner: learnerSnapshotFixture,
      problemKey: 'problem',
      conversation: [],
      settings,
    });

    expect(guarded.allowed).toBe(true);
    expect(guarded.allowVisualization).toBe(false);
  });

  it('ends the session when learner evidence demonstrates the optimal solution', async () => {
    mocks.parse.mockResolvedValueOnce({
      output_parsed: {
        allowed: true,
        violations: ['none'],
        safeReply: 'That approach is correct. Want to discuss implementation?',
        nextStage: 'complete',
        solutionStatus: 'optimal',
        allowVisualization: true,
        profileObservations: [],
      },
    });
    const conversation = [
      {
        id: 'learner-solution',
        role: 'user' as const,
        content:
          'I will preserve surplus while expanding each unmet demand, so every conversion is processed once in linear time.',
        createdAt: 1,
      },
    ];

    const guarded = await guardCoachResponse({
      sessionId: 'session-1',
      stage: 'listen',
      latestLearnerMessage: conversation[0]!.content,
      candidateReply: 'That approach is correct. Want to discuss implementation?',
      visualization: sceneFixture,
      coachingMap: coachingMapFixture,
      learner: learnerSnapshotFixture,
      problemKey: 'problem',
      conversation,
      settings,
    });

    expect(guarded.solutionStatus).toBe('optimal');
    expect(guarded.nextStage).toBe('complete');
    expect(guarded.safeReply).toMatch(/arrived at an optimal solution/i);
    expect(guarded.safeReply).toMatch(/session is complete/i);
    expect(guarded.safeReply).not.toContain('?');
    expect(guarded.allowVisualization).toBe(false);
    expect(mocks.parse.mock.calls[0]?.[0].input).toContain(
      'UNTRUSTED_CONVERSATION_EVIDENCE_START',
    );
  });

  it('does not complete from an ungrounded next-stage request', async () => {
    mocks.parse.mockResolvedValueOnce({
      output_parsed: {
        allowed: true,
        violations: ['none'],
        safeReply: 'What invariant makes that loop safe?',
        nextStage: 'complete',
        solutionStatus: 'in-progress',
        allowVisualization: false,
        profileObservations: [],
      },
    });

    const guarded = await guardCoachResponse({
      sessionId: 'session-1',
      stage: 'clarify',
      latestLearnerMessage: 'I think I solved it.',
      candidateReply: 'What invariant makes that loop safe?',
      coachingMap: coachingMapFixture,
      learner: learnerSnapshotFixture,
      problemKey: 'problem',
      conversation: [],
      settings,
    });

    expect(guarded.solutionStatus).toBe('in-progress');
    expect(guarded.nextStage).toBe('clarify');
  });

  it('fails closed if a rewritten reply still contains a solution leak', async () => {
    mocks.parse.mockResolvedValueOnce({
      output_parsed: {
        allowed: false,
        violations: ['complete-code'],
        safeReply:
          'Here is the full solution:\n```python\n' +
          'def solve():\n    return 1\n'.repeat(10) +
          '```',
        nextStage: 'connect',
        solutionStatus: 'in-progress',
        allowVisualization: true,
        profileObservations: [],
      },
    });

    const guarded = await guardCoachResponse({
      sessionId: 'session-1',
      stage: 'listen',
      latestLearnerMessage: 'Give me the answer.',
      candidateReply: 'unsafe',
      visualization: sceneFixture,
      coachingMap: coachingMapFixture,
      learner: learnerSnapshotFixture,
      problemKey: 'problem',
      conversation: [],
      settings,
    });

    expect(guarded.allowed).toBe(false);
    expect(guarded.allowVisualization).toBe(false);
    expect(guarded.safeReply).toMatch(/slow this down/i);
  });
});
