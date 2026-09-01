import { describe, expect, it } from 'vitest';
import {
  EMPTY_SESSION_USAGE,
  addSessionUsage,
  summarizeResponseUsage,
} from '../../src/agent/usage';

describe('session model usage', () => {
  it('prices standard tokens without double-charging cached or reasoning tokens', () => {
    const usage = summarizeResponseUsage({
      input_tokens: 1_000,
      input_tokens_details: {
        cached_tokens: 200,
        cache_write_tokens: 100,
      },
      output_tokens: 500,
      output_tokens_details: { reasoning_tokens: 350 },
      total_tokens: 1_500,
    });

    expect(usage).toEqual({
      modelCalls: 1,
      inputTokens: 1_000,
      cachedInputTokens: 200,
      cacheWriteTokens: 100,
      outputTokens: 500,
      reasoningTokens: 350,
      estimatedCostUsd: 0.01338,
    });
  });

  it('adds call usage without mutating the empty baseline', () => {
    const call = summarizeResponseUsage({
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 3 },
      total_tokens: 15,
    });

    expect(addSessionUsage(EMPTY_SESSION_USAGE, call)).toEqual(call);
    expect(EMPTY_SESSION_USAGE.modelCalls).toBe(0);
    expect(summarizeResponseUsage()).toEqual(EMPTY_SESSION_USAGE);
  });
});
