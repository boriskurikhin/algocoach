import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publicSettingsFixture } from '../fixtures/openai';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: mocks.sendMessage,
    },
  },
}));

import { sendExtensionRequest } from '../../src/messaging/client';

describe('extension request client', () => {
  beforeEach(() => {
    mocks.sendMessage.mockReset();
  });

  it('validates response data against the request type', async () => {
    mocks.sendMessage.mockResolvedValue({
      ok: true,
      data: publicSettingsFixture,
    });

    await expect(sendExtensionRequest({ type: 'settings:get' })).resolves.toEqual(
      publicSettingsFixture,
    );
  });

  it('rejects malformed response data at the messaging boundary', async () => {
    mocks.sendMessage.mockResolvedValue({
      ok: true,
      data: { ...publicSettingsFixture, hasApiKey: 'yes' },
    });

    await expect(sendExtensionRequest({ type: 'settings:get' })).rejects.toThrow(
      'invalid response',
    );
  });
});
