import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  learnerSnapshotFixture,
  problemAnalysisFixture,
  problemFixture,
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

import { analyzeProblem } from '../../src/agent/problem-analysis';
import { OPENAI_CONNECTION_TIMEOUT_MS } from '../../src/agent/schemas';

describe('private problem analysis', () => {
  beforeEach(() => {
    resetResponseMocks(mocks);
    mocks.parse.mockResolvedValue({ output_parsed: problemAnalysisFixture });
  });

  it('uses structured, non-stored analysis with explicit trust boundaries', async () => {
    await expect(
      analyzeProblem(problemFixture, learnerSnapshotFixture, {
        ...settings,
        reasoningMode: 'pro',
      }),
    ).resolves.toEqual(problemAnalysisFixture);

    const request = mocks.parse.mock.calls[0]?.[0];
    expect(request.model).toBe('gpt-5.6-sol');
    expect(request.store).toBe(false);
    expect(request.service_tier).toBe('default');
    expect(request).not.toHaveProperty('prompt_cache_key');
    expect(request.reasoning).toEqual({ effort: 'high', mode: 'pro' });
    expect(request.text.verbosity).toBe('low');
    expect(request.max_output_tokens).toBe(64_000);
    expect(request.input).toContain('UNTRUSTED_PROBLEM_DATA_START');
    expect(request.input).toContain('UNCERTAIN_LEARNER_SNAPSHOT_START');
    expect(request.instructions).toContain('private');
    expect(request.instructions).toContain('Codeforces-equivalent difficulty');
    expect(JSON.stringify(request)).not.toContain('test-only-key');
  });

  it('fails closed when structured analysis is absent', async () => {
    mocks.parse.mockResolvedValueOnce({ output_parsed: null });
    await expect(
      analyzeProblem(problemFixture, learnerSnapshotFixture, settings),
    ).rejects.toThrow('incomplete problem analysis');
  });

  it('binds the model request to its extension session', async () => {
    const controller = new AbortController();
    await analyzeProblem(
      problemFixture,
      learnerSnapshotFixture,
      settings,
      undefined,
      controller.signal,
    );

    expect(mocks.parse.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it('reports final token usage to the session accumulator', async () => {
    const onUsage = vi.fn();
    mocks.parse.mockResolvedValueOnce({
      output_parsed: problemAnalysisFixture,
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 20, cache_write_tokens: 0 },
        output_tokens: 50,
        output_tokens_details: { reasoning_tokens: 30 },
        total_tokens: 150,
      },
    });

    await analyzeProblem(
      problemFixture,
      learnerSnapshotFixture,
      settings,
      undefined,
      undefined,
      onUsage,
    );

    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        modelCalls: 1,
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 50,
        reasoningTokens: 30,
      }),
    );
  });

  it('explains when reasoning consumes the output budget', async () => {
    mocks.parse.mockResolvedValueOnce({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output_parsed: null,
    });
    await expect(
      analyzeProblem(problemFixture, learnerSnapshotFixture, settings),
    ).rejects.toThrow('reasoning/output budget');
  });

  it('lets an accepted model stream run past the former wall-clock cutoff', async () => {
    vi.useFakeTimers();
    try {
      let finishResponse!: (value: {
        output_parsed: typeof problemAnalysisFixture;
      }) => void;
      mocks.parse.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishResponse = resolve;
          }),
      );
      const result = analyzeProblem(problemFixture, learnerSnapshotFixture, settings);

      await vi.advanceTimersByTimeAsync(OPENAI_CONNECTION_TIMEOUT_MS);
      finishResponse({ output_parsed: problemAnalysisFixture });

      await expect(result).resolves.toEqual(problemAnalysisFixture);
    } finally {
      vi.useRealTimers();
    }
  });
});
