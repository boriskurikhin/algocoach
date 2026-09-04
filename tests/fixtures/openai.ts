import type { Mock } from 'vitest';
import type { PublicSettings } from '../../src/messaging/schema';
import type { ExtensionSettings } from '../../src/storage/local';

export const settingsFixture: ExtensionSettings = {
  apiKey: 'test-only-key',
};

export const publicSettingsFixture: PublicSettings = {
  hasApiKey: false,
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
        let rejectAbort: ((error: Error) => void) | undefined;
        const aborted = new Promise<never>((_resolve, reject) => {
          rejectAbort = reject;
        });
        const responseStream = {
          on: () => responseStream,
          finalResponse: () =>
            Promise.race([
              Promise.resolve().then(() => mocks.parse(body, options)),
              aborted,
            ]),
          abort: () => rejectAbort?.(new actual.default.APIUserAbortError()),
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
