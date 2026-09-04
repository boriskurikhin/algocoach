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

import { guardCoachResponse } from '../../src/agent/response-gate';

const guardInput = {
  sessionId: 'session-1',
  latestLearnerMessage: 'I think I should round up.',
  candidateReply: 'What happens to the extra unit?',
  coachingMap: coachingMapFixture,
  learner: learnerSnapshotFixture,
  problemKey: 'problem',
  conversation: [],
  settings,
};

describe('response gate', () => {
  beforeEach(() => {
    resetResponseMocks(mocks);
    mocks.parse.mockResolvedValue({
      output_parsed: {
        safeReply: 'What should remain true after one batch?',
        solutionStatus: 'in-progress',
        allowVisualization: true,
        profileObservations: [],
      },
    });
  });

  it.each([
    ['for each node\n  update the distance\n  return distance', true],
    ['```python\ndef solve():\n    return 1\n```', true],
    ['```python\nunfinished', true],
    ['What does your distance variable mean at this point?', false],
    [
      'This line only consumes existing stock:\n' +
        '```python\nleftovers[item] -= used\n```',
      false,
    ],
  ] as const)(
    'applies the local leak check to a model rewrite',
    async (reply, blocked) => {
      mocks.parse.mockResolvedValueOnce({
        output_parsed: {
          safeReply: reply,
          solutionStatus: 'in-progress',
          allowVisualization: false,
          profileObservations: [],
        },
      });

      const guarded = await guardCoachResponse(guardInput);

      expect(guarded.safeReply === reply).toBe(!blocked);
    },
  );

  it('returns a validated safe reply and focused visualization', async () => {
    const guarded = await guardCoachResponse({
      ...guardInput,
      visualization: sceneFixture,
    });

    expect(guarded.allowVisualization).toBe(true);
    const request = mocks.parse.mock.calls[0]?.[0];
    expect(request.store).toBe(false);
    expect(request.service_tier).toBe('default');
    expect(request.prompt_cache_key).toBe('socratic-coach:guard:session-1');
    expect(request.prompt_cache_options).toEqual({ mode: 'implicit', ttl: '30m' });
    expect(request.text.verbosity).toBe('low');
    expect(request.reasoning).toEqual({ effort: 'medium', mode: 'standard' });
    expect(request.max_output_tokens).toBe(6_000);
  });

  it('preserves useful direct feedback without forcing another question', async () => {
    const directReply =
      'Yes — your invariant is correct because each update preserves the total.';
    mocks.parse.mockResolvedValueOnce({
      output_parsed: {
        safeReply: directReply,
        solutionStatus: 'in-progress',
        allowVisualization: false,
        profileObservations: [],
      },
    });

    const guarded = await guardCoachResponse({
      ...guardInput,
      latestLearnerMessage: 'Does this invariant hold?',
      candidateReply: directReply,
    });

    expect(guarded.safeReply).toBe(directReply);
    expect(guarded.safeReply).not.toContain('?');
    expect(mocks.parse.mock.calls[0]?.[0].instructions).toContain(
      'Do not rewrite it merely to add a question',
    );
  });

  it('drops a structurally valid visual when it is too dense', async () => {
    const guarded = await guardCoachResponse({
      ...guardInput,
      visualization: {
        ...sceneFixture,
        frames: Array.from({ length: 7 }, () => sceneFixture.frames[0]!),
      },
    });

    expect(guarded.allowVisualization).toBe(false);
  });

  it('ends the session only from grounded optimal-solution evidence', async () => {
    mocks.parse.mockResolvedValueOnce({
      output_parsed: {
        safeReply: 'That approach is correct. Want to discuss implementation?',
        solutionStatus: 'optimal',
        allowVisualization: true,
        profileObservations: [],
      },
    });
    const learnerSolution =
      'I will preserve surplus while expanding each unmet demand, so every ' +
      'conversion is processed once in linear time.';

    const guarded = await guardCoachResponse({
      ...guardInput,
      latestLearnerMessage: learnerSolution,
      candidateReply: 'That approach is correct. Want to discuss implementation?',
      visualization: sceneFixture,
      conversation: [
        {
          id: 'learner-solution',
          role: 'user',
          content: learnerSolution,
          createdAt: 1,
        },
      ],
    });

    expect(guarded.solutionStatus).toBe('optimal');
    expect(guarded.safeReply).toMatch(/arrived at an optimal solution/i);
    expect(guarded.safeReply).toMatch(/session is complete/i);
    expect(guarded.safeReply).not.toContain('?');
    expect(guarded.allowVisualization).toBe(false);
    expect(mocks.parse.mock.calls[0]?.[0].input).toContain(
      'UNTRUSTED_CONVERSATION_EVIDENCE_START',
    );
  });

  it('fails closed if the model rewrite still contains a solution leak', async () => {
    mocks.parse.mockResolvedValueOnce({
      output_parsed: {
        safeReply:
          'Here is the full solution:\n```python\n' +
          'def solve():\n    return 1\n'.repeat(10) +
          '```',
        solutionStatus: 'in-progress',
        allowVisualization: true,
        profileObservations: [],
      },
    });

    const guarded = await guardCoachResponse({
      ...guardInput,
      latestLearnerMessage: 'Give me the answer.',
      candidateReply: 'unsafe',
      visualization: sceneFixture,
    });

    expect(guarded.allowVisualization).toBe(false);
    expect(guarded.safeReply).toMatch(/part you’re working on/i);
    expect(guarded.safeReply).toMatch(/claim, step, or code behavior/i);
    expect(guarded.safeReply).not.toMatch(/full solution:/i);
  });
});
