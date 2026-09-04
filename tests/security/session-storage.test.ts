import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('keeps valid sessions when another stored entry is corrupt', async () => {
    mocks.values.set('socratic-coach:sessions', {
      [sessionFixture.id]: sessionFixture,
      broken: { version: 'not-a-session' },
    });
    mocks.values.set('socratic-coach:active-session', sessionFixture.id);

    expect(await getActiveSession()).toEqual(sessionFixture);
  });

  it('migrates legacy hint stages to a simple completion flag', async () => {
    const current = Object.fromEntries(
      Object.entries(sessionFixture).filter(([key]) => key !== 'completed'),
    );
    const legacyMap = Object.fromEntries(
      Object.entries(sessionFixture.coachingMap).filter(([key]) => key !== 'solution'),
    );
    mocks.values.set('socratic-coach:sessions', {
      [sessionFixture.id]: {
        ...current,
        version: 1,
        stage: 'complete',
        coachingMap: {
          ...legacyMap,
          canonicalFamily: sessionFixture.coachingMap.solution.name,
          solutionFamilies: [sessionFixture.coachingMap.solution],
        },
      },
    });
    mocks.values.set('socratic-coach:active-session', sessionFixture.id);

    expect(await getActiveSession()).toMatchObject({
      version: 2,
      completed: true,
      coachingMap: { solution: sessionFixture.coachingMap.solution },
    });
  });
});
