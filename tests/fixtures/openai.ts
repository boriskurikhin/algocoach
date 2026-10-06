import type { Mock } from 'vitest';
import type { PublicSettings } from '../../src/messaging/schema';
import { CURRENT_DATA_USE_CONSENT_VERSION } from '../../src/privacy';
import type { ExtensionSettings } from '../../src/storage/local';

export const settingsFixture: ExtensionSettings = {
  apiKey: 'test-only-key',
  dataUseConsentVersion: CURRENT_DATA_USE_CONSENT_VERSION,
};

export const publicSettingsFixture: PublicSettings = {
  hasApiKey: false,
  hasDataUseConsent: true,
};

interface ResponseMocks {
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
      stream: (body: unknown, options: unknown) => ({
        finalResponse: () => Promise.resolve().then(() => mocks.parse(body, options)),
      }),
    } as never;
  }
  return { ...actual, default: StubbedOpenAI };
}

export function resetResponseMocks(mocks: ResponseMocks): void {
  mocks.parse.mockReset();
}
