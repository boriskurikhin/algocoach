import { describe, expect, it } from 'vitest';
import {
  reasoningPlanForProblem,
  reasoningPlanForRating,
} from '../../src/agent/reasoning';
import { problemFixture } from '../fixtures/domain';

describe('adaptive model reasoning', () => {
  it.each([
    'Easy',
    'Bronze',
    'Medium',
    'Silver',
    'Hard',
    'Gold',
    'Platinum',
    '*1700',
  ] as const)('keeps startup analysis bounded for site difficulty %s', (rating) => {
    expect(reasoningPlanForProblem({ ...problemFixture, rating }, 'analysis')).toEqual({
      model: 'gpt-6-astra',
      effort: 'low',
      maxOutputTokens: 6_000,
    });
  });

  it('does not let a persisted rating make startup block longer', () => {
    expect(
      reasoningPlanForProblem(
        {
          ...problemFixture,
          rating: 'Easy',
          codeforcesRating: { value: 2_500, source: 'official' },
        },
        'analysis',
      ),
    ).toEqual({
      model: 'gpt-6-astra',
      effort: 'low',
      maxOutputTokens: 6_000,
    });
  });

  it('keeps direct analysis planning low-latency at every rating', () => {
    for (const rating of [1_000, 1_700, 2_100, 2_500, 3_000]) {
      expect(reasoningPlanForRating(rating, 'analysis')).toEqual({
        model: 'gpt-6-astra',
        effort: 'low',
        maxOutputTokens: 6_000,
      });
    }
  });

  it('still scales substantive coaching and safety checks', () => {
    expect(reasoningPlanForRating(2_500, 'coach')).toEqual({
      model: 'gpt-6-astra',
      effort: 'xhigh',
      maxOutputTokens: 32_000,
    });
    expect(reasoningPlanForRating(3_000, 'guard')).toEqual({
      model: 'gpt-6-astra',
      effort: 'max',
      maxOutputTokens: 24_000,
    });
  });

  it('uses a conservative medium plan when the page has no difficulty metadata', () => {
    expect(reasoningPlanForProblem(problemFixture, 'coach')).toEqual({
      model: 'gpt-6-astra',
      effort: 'medium',
      maxOutputTokens: 10_000,
    });
  });
});
