import type { Mock } from 'vitest';
import type { PublicSettings } from '../../src/messaging/schema';
import type { ExtensionSettings } from '../../src/storage/local';

export const settingsFixture: ExtensionSettings = {
  apiKey: 'test-only-key',
  model: 'gpt-5.6-sol',
  reasoningEffort: 'high',
  reasoningMode: 'standard',
};

export const publicSettingsFixture: PublicSettings = {
  hasApiKey: false,
  model: 'gpt-5.6-sol',
  reasoningEffort: 'high',
  reasoningMode: 'standard',
};

export interface ResponseMocks {
  parse: Mock;
}

/**
 * Replaces only the network surface of the SDK, so the shared request plumbing
 * in `openai-client` stays under test and no request can leave the machine.
 */
export async function stubOpenAI(
  mocks: ResponseMocks,
  importOriginal: () => Promise<typeof import('openai')>,
) {
  const actual = await importOriginal();
  class StubbedOpenAI extends actual.default {
    override responses = {
      stream: (body: unknown, options: unknown) => {
        const responseStream = {
          on: () => responseStream,
          finalResponse: () => mocks.parse(body, options),
        };
        return responseStream;
      },
    } as never;
  }
  return { ...actual, default: StubbedOpenAI };
}

export function resetResponseMocks(mocks: ResponseMocks): void {
  mocks.parse.mockReset();
}
