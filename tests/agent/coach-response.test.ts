import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  learnerSnapshotFixture,
  sceneFixture,
  sessionFixture,
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

import { draftCoachResponse } from '../../src/agent/coach-response';

describe('coach response drafting', () => {
  beforeEach(() => {
    resetResponseMocks(mocks);
  });

  it('parses a complete draft and local drawing tool', async () => {
    mocks.parse.mockResolvedValue({
      output_text: 'Which unit is not consumed?',
      output: [
        {
          type: 'function_call',
          name: 'draw_concept',
          parsed_arguments: sceneFixture,
        },
      ],
    });

    const result = await draftCoachResponse(
      sessionFixture,
      learnerSnapshotFixture,
      settings,
    );

    expect(result.reply).toBe('Which unit is not consumed?');
    expect(result.visualization).toEqual(sceneFixture);
    expect(mocks.parse.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        model: 'gpt-5.6-sol',
        service_tier: 'fast',
        store: false,
        parallel_tool_calls: false,
        text: { verbosity: 'low' },
        max_output_tokens: 12_000,
      }),
    );
  });

  it('uses the visualization question when the model emits no text', async () => {
    mocks.parse.mockResolvedValue({
      output_text: '',
      output: [
        {
          type: 'function_call',
          name: 'draw_concept',
          parsed_arguments: sceneFixture,
        },
      ],
    });

    const result = await draftCoachResponse(
      sessionFixture,
      learnerSnapshotFixture,
      settings,
    );
    expect(result.reply).toBe(sceneFixture.question);
  });
});
