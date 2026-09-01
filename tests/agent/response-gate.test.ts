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
      stage: 'listen',
      latestLearnerMessage: 'I think I should round up.',
      candidateReply: 'What happens to the extra unit?',
      visualization: sceneFixture,
      coachingMap: coachingMapFixture,
      learner: learnerSnapshotFixture,
      problemKey: 'problem',
      settings,
    });

    expect(guarded.nextStage).toBe('clarify');
    expect(guarded.allowVisualization).toBe(true);
    expect(mocks.parse.mock.calls[0]?.[0].store).toBe(false);
    expect(mocks.parse.mock.calls[0]?.[0].service_tier).toBe('fast');
    expect(mocks.parse.mock.calls[0]?.[0].text.verbosity).toBe('low');
    expect(mocks.parse.mock.calls[0]?.[0].max_output_tokens).toBe(12_000);
  });

  it('does not silently regress the hint stage', async () => {
    mocks.parse.mockResolvedValueOnce({
      output_parsed: {
        allowed: true,
        violations: ['none'],
        safeReply: 'What boundary case challenges that invariant?',
        nextStage: 'listen',
        allowVisualization: false,
        profileObservations: [],
      },
    });

    const guarded = await guardCoachResponse({
      stage: 'boundary',
      latestLearnerMessage: 'My invariant fails on an empty input.',
      candidateReply: 'What boundary case challenges that invariant?',
      coachingMap: coachingMapFixture,
      learner: learnerSnapshotFixture,
      problemKey: 'problem',
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
        allowVisualization: true,
        profileObservations: [],
      },
    });

    const guarded = await guardCoachResponse({
      stage: 'listen',
      latestLearnerMessage: 'Show me the full graph traversal.',
      candidateReply: 'Trace every edge like this.',
      visualization: sceneFixture,
      coachingMap: coachingMapFixture,
      learner: learnerSnapshotFixture,
      problemKey: 'problem',
      settings,
    });

    expect(guarded.allowVisualization).toBe(false);
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
        allowVisualization: true,
        profileObservations: [],
      },
    });

    const guarded = await guardCoachResponse({
      stage: 'listen',
      latestLearnerMessage: 'Give me the answer.',
      candidateReply: 'unsafe',
      visualization: sceneFixture,
      coachingMap: coachingMapFixture,
      learner: learnerSnapshotFixture,
      problemKey: 'problem',
      settings,
    });

    expect(guarded.allowed).toBe(false);
    expect(guarded.allowVisualization).toBe(false);
    expect(guarded.safeReply).toMatch(/slow this down/i);
  });
});
