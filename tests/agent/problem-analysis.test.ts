import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  coachingMapFixture,
  learnerSnapshotFixture,
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

describe('private problem analysis', () => {
  beforeEach(() => {
    resetResponseMocks(mocks);
    mocks.parse.mockResolvedValue({ output_parsed: coachingMapFixture });
  });

  it('uses structured, non-stored analysis with explicit trust boundaries', async () => {
    await expect(
      analyzeProblem(problemFixture, learnerSnapshotFixture, {
        ...settings,
        reasoningMode: 'pro',
      }),
    ).resolves.toEqual(coachingMapFixture);

    const request = mocks.parse.mock.calls[0]?.[0];
    expect(request.model).toBe('gpt-5.6-sol');
    expect(request.store).toBe(false);
    expect(request.service_tier).toBe('fast');
    expect(request.reasoning).toEqual({ effort: 'high', mode: 'standard' });
    expect(request.text.verbosity).toBe('low');
    expect(request.max_output_tokens).toBe(12_000);
    expect(request.input).toContain('UNTRUSTED_PROBLEM_DATA_START');
    expect(request.input).toContain('UNCERTAIN_LEARNER_SNAPSHOT_START');
    expect(request.instructions).toContain('private');
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

  it('explains when reasoning consumes the output budget', async () => {
    mocks.parse.mockResolvedValueOnce({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output_parsed: null,
    });
    await expect(
      analyzeProblem(problemFixture, learnerSnapshotFixture, settings),
    ).rejects.toThrow('reasoning budget');
  });
});
