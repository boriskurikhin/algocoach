import type { ResponseUsage } from 'openai/resources/responses/responses';
import { z } from 'zod';

const tokenCount = z.number().int().nonnegative();

export const SessionUsageSchema = z.object({
  modelCalls: tokenCount,
  inputTokens: tokenCount,
  cachedInputTokens: tokenCount,
  cacheWriteTokens: tokenCount,
  outputTokens: tokenCount,
  reasoningTokens: tokenCount,
  estimatedCostUsd: z.number().nonnegative(),
});

export type SessionUsage = z.infer<typeof SessionUsageSchema>;

export const EMPTY_SESSION_USAGE: SessionUsage = {
  modelCalls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  estimatedCostUsd: 0,
};

/**
 * GPT-5.6 Sol standard short-context rates published by OpenAI on 2026-09-01.
 * Prices are promotional and may differ from the user's eventual invoice.
 */
export const STANDARD_TOKEN_PRICES_PER_MILLION = {
  input: 4,
  cachedInput: 0.4,
  cacheWrite: 5,
  output: 20,
} as const;

export const SESSION_COST_ESTIMATE_NOTE =
  'Estimated from OpenAI-reported usage at GPT-5.6 Sol standard short-context rates checked September 1, 2026; actual billing may vary.';

const bounded = (value: number | undefined, limit: number) =>
  Math.min(Math.max(0, value ?? 0), limit);

export function summarizeResponseUsage(usage?: ResponseUsage): SessionUsage {
  if (!usage) return { ...EMPTY_SESSION_USAGE };

  const inputTokens = Math.max(0, usage.input_tokens);
  const cachedInputTokens = bounded(
    usage.input_tokens_details?.cached_tokens,
    inputTokens,
  );
  const cacheWriteTokens = bounded(
    usage.input_tokens_details?.cache_write_tokens,
    inputTokens - cachedInputTokens,
  );
  const regularInputTokens = inputTokens - cachedInputTokens - cacheWriteTokens;
  const outputTokens = Math.max(0, usage.output_tokens);
  const reasoningTokens = bounded(
    usage.output_tokens_details?.reasoning_tokens,
    outputTokens,
  );
  const prices = STANDARD_TOKEN_PRICES_PER_MILLION;
  const estimatedCostUsd =
    (regularInputTokens * prices.input +
      cachedInputTokens * prices.cachedInput +
      cacheWriteTokens * prices.cacheWrite +
      outputTokens * prices.output) /
    1_000_000;

  return {
    modelCalls: 1,
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens,
    estimatedCostUsd,
  };
}

export function addSessionUsage(left: SessionUsage, right: SessionUsage): SessionUsage {
  return {
    modelCalls: left.modelCalls + right.modelCalls,
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    estimatedCostUsd: left.estimatedCostUsd + right.estimatedCostUsd,
  };
}
