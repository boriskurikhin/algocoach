import { describe, expect, it } from 'vitest';
import {
  reasoningPlanForProblem,
  reasoningPlanForRating,
} from '../../src/agent/reasoning';
import { problemFixture } from '../fixtures/domain';

describe('adaptive model reasoning', () => {
  it.each([
    ['Easy', 'gpt-6-astra', 'low', 8_000],
    ['Bronze', 'gpt-6-astra', 'low', 8_000],
    ['Medium', 'gpt-6-astra', 'medium', 16_000],
    ['Silver', 'gpt-6-astra', 'medium', 16_000],
    ['Hard', 'gpt-6-astra', 'high', 32_000],
    ['Gold', 'gpt-6-astra', 'high', 32_000],
    ['Platinum', 'gpt-6-astra', 'xhigh', 48_000],
    ['*1700', 'gpt-6-astra', 'medium', 16_000],
  ] as const)(
    'routes site difficulty %s to %s at %s',
    (rating, model, effort, maxOutputTokens) => {
      expect(
        reasoningPlanForProblem({ ...problemFixture, rating }, 'analysis'),
      ).toEqual({ model, effort, maxOutputTokens });
    },
  );

  it('prefers a persisted Codeforces rating over site labels', () => {
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
      effort: 'xhigh',
      maxOutputTokens: 48_000,
    });
  });

  it.each([
    [1_000, 'gpt-6-astra', 'low', 8_000],
    [1_700, 'gpt-6-astra', 'medium', 16_000],
    [2_100, 'gpt-6-astra', 'high', 32_000],
    [2_500, 'gpt-6-astra', 'xhigh', 48_000],
    [3_000, 'gpt-6-astra', 'max', 64_000],
  ] as const)(
    'scales analysis for a %i-rated problem to %s at %s',
    (rating, model, effort, maxOutputTokens) => {
      expect(reasoningPlanForRating(rating, 'analysis')).toEqual({
        model,
        effort,
        maxOutputTokens,
      });
    },
  );

  it('uses a conservative medium plan when the page has no difficulty metadata', () => {
    expect(reasoningPlanForProblem(problemFixture, 'coach')).toEqual({
      model: 'gpt-6-astra',
      effort: 'medium',
      maxOutputTokens: 10_000,
    });
  });
});
