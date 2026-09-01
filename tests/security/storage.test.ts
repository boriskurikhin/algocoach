import { beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsFixture } from '../fixtures/openai';

const mocks = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    setAccessLevel: vi.fn(),
    get: vi.fn(async (key: string) => ({ [key]: values.get(key) })),
    set: vi.fn(async (entries: Record<string, unknown>) => {
      Object.entries(entries).forEach(([key, value]) => values.set(key, value));
    }),
  };
});

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: mocks.get,
        set: mocks.set,
        setAccessLevel: mocks.setAccessLevel,
      },
    },
  },
}));

import {
  exportLocalData,
  getSettings,
  restrictLocalStorageToTrustedContexts,
  saveSettings,
} from '../../src/storage/local';
import { createOpenAIClient, safeOpenAIError } from '../../src/agent/openai-client';

describe('local credential and profile storage', () => {
  beforeEach(() => {
    mocks.values.clear();
    mocks.get.mockClear();
    mocks.set.mockClear();
    mocks.setAccessLevel.mockClear();
  });

  it('restricts storage to trusted extension contexts', async () => {
    await restrictLocalStorageToTrustedContexts();
    expect(mocks.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
  });

  it('keeps the API key available internally but excludes it from exports', async () => {
    await saveSettings({
      apiKey: 'sk-secret-test-value',
      model: 'gpt-5.6-sol',
    });
    expect((await getSettings()).apiKey).toBe('sk-secret-test-value');

    const exported = await exportLocalData();
    expect(exported).not.toContain('sk-secret-test-value');
    expect(JSON.parse(exported).settings.hasApiKey).toBe(true);
  });

  it('upgrades old lower-effort settings without losing the API key', async () => {
    mocks.values.set('socratic-coach:settings', {
      ...settingsFixture,
      reasoningEffort: 'low',
    });

    expect(await getSettings()).toMatchObject({
      apiKey: settingsFixture.apiKey,
      reasoningEffort: 'high',
    });
  });

  it('fails closed without a key and never exposes arbitrary error text', () => {
    expect(() => createOpenAIClient({ ...settingsFixture, apiKey: '' })).toThrow(
      /Add an OpenAI API key/,
    );
    expect(safeOpenAIError(new Error('secret internal detail'))).toBe(
      'The coach hit an internal error. Reload the extension and try again.',
    );
  });
});
