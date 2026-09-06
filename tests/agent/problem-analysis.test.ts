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
      analyzeProblem({
        problem: problemFixture,
        learner: learnerSnapshotFixture,
        settings,
      }),
    ).resolves.toEqual(problemAnalysisFixture);

    const request = mocks.parse.mock.calls[0]?.[0];
    expect(request.model).toBe('gpt-6-astra');
    expect(request.store).toBe(false);
    expect(request.service_tier).toBe('default');
    expect(request.prompt_cache_key).toBe('socratic-coach:analysis');
    expect(request.reasoning).toEqual({ effort: 'medium', mode: 'standard' });
    expect(request.text.verbosity).toBe('low');
    expect(request.max_output_tokens).toBe(16_000);
    expect(request.input).toContain('UNTRUSTED_PROBLEM_DATA_START');
    expect(request.input).toContain('UNCERTAIN_LEARNER_SNAPSHOT_START');
    expect(request.instructions).toContain('private');
    expect(request.instructions).toContain('Codeforces-equivalent difficulty');
    expect(JSON.stringify(request)).not.toContain('test-only-key');
  });

  it('fails closed when structured analysis is absent', async () => {
    mocks.parse.mockResolvedValueOnce({ output_parsed: null });
    await expect(
      analyzeProblem({
        problem: problemFixture,
        learner: learnerSnapshotFixture,
        settings,
      }),
    ).rejects.toThrow('incomplete problem analysis');
  });

  it('binds the model request to its extension session', async () => {
    const controller = new AbortController();
    await analyzeProblem({
      problem: problemFixture,
      learner: learnerSnapshotFixture,
      settings,
      signal: controller.signal,
    });

    expect(mocks.parse.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it('explains when reasoning consumes the output budget', async () => {
    mocks.parse.mockResolvedValueOnce({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output_parsed: null,
    });
    await expect(
      analyzeProblem({
        problem: problemFixture,
        learner: learnerSnapshotFixture,
        settings,
      }),
    ).rejects.toThrow('could not finish this step');
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
      const result = analyzeProblem({
        problem: problemFixture,
        learner: learnerSnapshotFixture,
        settings,
      });

      await vi.advanceTimersByTimeAsync(OPENAI_CONNECTION_TIMEOUT_MS);
      finishResponse({ output_parsed: problemAnalysisFixture });

      await expect(result).resolves.toEqual(problemAnalysisFixture);
    } finally {
      vi.useRealTimers();
    }
  });
});
