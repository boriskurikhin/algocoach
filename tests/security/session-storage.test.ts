import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_SESSION_USAGE } from '../../src/agent/usage';
import { sessionFixture } from '../fixtures/domain';

const mocks = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    get: vi.fn(async (key: string) => ({ [key]: values.get(key) })),
    set: vi.fn(async (entries: Record<string, unknown>) => {
      Object.entries(entries).forEach(([key, value]) => values.set(key, value));
    }),
  };
});

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      session: {
        get: mocks.get,
        set: mocks.set,
      },
    },
  },
}));

import {
  clearActiveSession,
  getActiveSession,
  getSession,
  saveSession,
} from '../../src/storage/session';

describe('ephemeral coaching-session storage', () => {
  beforeEach(() => {
    mocks.values.clear();
    vi.clearAllMocks();
  });

  it('retains only the ten most recently updated sessions', async () => {
    for (let index = 0; index < 12; index += 1) {
      await saveSession({
        ...sessionFixture,
        id: `session-${index}`,
        updatedAt: index,
      });
    }

    expect(await getSession('session-0')).toBeNull();
    expect(await getSession('session-1')).toBeNull();
    expect(await getSession('session-11')).toMatchObject({ updatedAt: 11 });
  });

  it('restores the active session until the learner changes problems', async () => {
    const saved = await saveSession(sessionFixture);
    expect(await getActiveSession()).toEqual(saved);

    await clearActiveSession(sessionFixture.id);
    expect(await getActiveSession()).toBeNull();
    expect(await getSession(sessionFixture.id)).toEqual(saved);
  });

  it('migrates the most recent session when no active pointer exists', async () => {
    await saveSession({ ...sessionFixture, id: 'older', updatedAt: 1 });
    await saveSession({ ...sessionFixture, id: 'newer', updatedAt: 2 });
    mocks.values.delete('socratic-coach:active-session');

    expect(await getActiveSession()).toMatchObject({ id: 'newer' });
  });

  it('backfills usage for sessions saved before accounting was added', async () => {
    const legacy = Object.fromEntries(
      Object.entries(sessionFixture).filter(([key]) => key !== 'usage'),
    );
    mocks.values.set('socratic-coach:sessions', {
      [sessionFixture.id]: legacy,
    });
    mocks.values.set('socratic-coach:active-session', sessionFixture.id);

    expect(await getActiveSession()).toMatchObject({
      usage: EMPTY_SESSION_USAGE,
    });
  });
});
