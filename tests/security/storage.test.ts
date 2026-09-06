import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyLearnerProfile } from '../../src/learner/update-profile';
import { serializedByteLength } from '../../src/storage/size';
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
  compactLearnerProfile,
  exportLocalData,
  getSettings,
  MAX_AUTO_PROFILE_ENTRIES,
  restrictLocalStorageToTrustedContexts,
  saveLearnerProfile,
  saveSettings,
} from '../../src/storage/local';
import { createOpenAIClient, safeOpenAIError } from '../../src/agent/openai-client';

const knowledgeEstimate = (
  lastObservedAt: number,
  options: { pinned?: boolean; evidenceCount?: number } = {},
) => ({
  level: 'practicing' as const,
  confidence: 0.8,
  sampleCount: 12,
  demonstratedCount: 2,
  lastObservedAt,
  pinned: options.pinned ?? false,
  evidence: Array.from({ length: options.evidenceCount ?? 0 }, (_, index) => ({
    id: `${lastObservedAt}-${index}`,
    at: lastObservedAt + index,
    type: 'demonstrated' as const,
    note: 'x'.repeat(300),
    problemKey: `https://example.com/${'p'.repeat(450)}`,
    supports: true,
  })),
});

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
    });
    expect((await getSettings()).apiKey).toBe('sk-secret-test-value');

    const exported = await exportLocalData();
    expect(exported).not.toContain('sk-secret-test-value');
    expect(JSON.parse(exported).settings.hasApiKey).toBe(true);
  });

  it('bounds automatically inferred entries while preserving pinned corrections', async () => {
    const profile = createEmptyLearnerProfile(0);
    for (let index = 0; index <= MAX_AUTO_PROFILE_ENTRIES; index += 1) {
      profile.concepts[`concept-${index}`] = knowledgeEstimate(index);
    }
    profile.concepts['learner-pinned'] = knowledgeEstimate(0, { pinned: true });

    const saved = await saveLearnerProfile(profile);

    expect(saved.concepts['concept-0']).toBeUndefined();
    expect(saved.concepts[`concept-${MAX_AUTO_PROFILE_ENTRIES}`]).toBeDefined();
    expect(saved.concepts['learner-pinned']).toMatchObject({ pinned: true });
    expect(Object.values(saved.concepts).filter(({ pinned }) => !pinned)).toHaveLength(
      MAX_AUTO_PROFILE_ENTRIES,
    );
  });

  it('drops old detail before exceeding the learner-profile byte budget', () => {
    const profile = createEmptyLearnerProfile(0);
    profile.concepts.old = knowledgeEstimate(1, { evidenceCount: 12 });
    profile.concepts.current = knowledgeEstimate(100, { evidenceCount: 12 });
    profile.concepts.pinned = knowledgeEstimate(0, {
      pinned: true,
      evidenceCount: 12,
    });
    const maxBytes = 1_500;

    const compacted = compactLearnerProfile(profile, {
      maxAutoEntries: 10,
      maxBytes,
    });

    expect(serializedByteLength(compacted)).toBeLessThanOrEqual(maxBytes);
    expect(compacted.concepts.pinned).toBeDefined();
    expect(compacted.concepts.old).toBeUndefined();
  });

  it('fails closed without a key and never exposes arbitrary error text', () => {
    expect(() => createOpenAIClient({ ...settingsFixture, apiKey: '' })).toThrow(
      /Add an API key/,
    );
    expect(safeOpenAIError(new Error('secret internal detail'))).toBe(
      'The coach hit an internal error. Reload the extension and try again.',
    );
  });
});
