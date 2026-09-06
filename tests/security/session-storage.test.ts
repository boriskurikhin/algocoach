import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionFixture } from '../fixtures/domain';

const mocks = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const state: { quotaBytes: number | null } = { quotaBytes: null };
  return {
    values,
    state,
    get: vi.fn(async (key: string) => ({ [key]: values.get(key) })),
    set: vi.fn(async (entries: Record<string, unknown>) => {
      if (
        state.quotaBytes !== null &&
        JSON.stringify(entries).length > state.quotaBytes
      ) {
        throw new Error('QUOTA_BYTES quota exceeded');
      }
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
  MAX_SESSION_STORAGE_BYTES,
  MAX_SINGLE_SESSION_BYTES,
  saveSession,
} from '../../src/storage/session';
import { serializedByteLength } from '../../src/storage/size';

const sessionWithMessages = (
  id: string,
  updatedAt: number,
  messageCount: number,
  messageChars: number,
) => ({
  ...sessionFixture,
  id,
  updatedAt,
  messages: Array.from({ length: messageCount }, (_, index) => ({
    id: `${id}-message-${index}`,
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `${index}`.padEnd(messageChars, 'x'),
    createdAt: index,
  })),
});

describe('ephemeral coaching-session storage', () => {
  beforeEach(() => {
    mocks.values.clear();
    mocks.state.quotaBytes = null;
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

  it('bounds each session by retaining its newest messages', async () => {
    const saved = await saveSession(sessionWithMessages('large', 1, 80, 30_000));

    expect(saved.messages.length).toBeLessThan(80);
    expect(saved.messages.at(-1)?.id).toBe('large-message-79');
    expect(serializedByteLength(saved)).toBeLessThanOrEqual(MAX_SINGLE_SESSION_BYTES);
  });

  it('drops duplicated problem fields before an active session exceeds its budget', async () => {
    const oversized = {
      ...sessionFixture,
      id: 'large-problem',
      problem: {
        ...sessionFixture.problem,
        constraints: Array.from({ length: 100 }, () => 'c'.repeat(1_000)),
        sections: Array.from({ length: 50 }, (_, index) => ({
          heading: `Section ${index}`,
          body: 's'.repeat(40_000),
        })),
      },
    };
    expect(serializedByteLength(oversized)).toBeGreaterThan(MAX_SINGLE_SESSION_BYTES);

    const saved = await saveSession(oversized);

    expect(serializedByteLength(saved)).toBeLessThanOrEqual(MAX_SINGLE_SESSION_BYTES);
    expect(saved.problem.statement).toBe(sessionFixture.problem.statement);
    expect(saved.problem.constraints).toEqual([]);
    expect(saved.problem.sections).toEqual([]);
  });

  it('evicts old sessions when their combined byte size reaches the budget', async () => {
    await saveSession(sessionWithMessages('oldest', 1, 60, 25_000));
    await saveSession(sessionWithMessages('middle', 2, 60, 25_000));
    await saveSession(sessionWithMessages('newest', 3, 60, 25_000));

    expect(await getSession('oldest')).toBeNull();
    expect(await getSession('middle')).not.toBeNull();
    expect(await getSession('newest')).not.toBeNull();
    expect(
      serializedByteLength(mocks.values.get('socratic-coach:sessions')),
    ).toBeLessThanOrEqual(MAX_SESSION_STORAGE_BYTES);
  });

  it('retries quota failures with only the active session', async () => {
    await saveSession({ ...sessionFixture, id: 'old', updatedAt: 1 });
    const current = { ...sessionFixture, id: 'current', updatedAt: 2 };
    mocks.state.quotaBytes =
      JSON.stringify({
        'socratic-coach:sessions': { [current.id]: current },
        'socratic-coach:active-session': current.id,
      }).length + 10;

    await saveSession(current);

    expect(await getSession('old')).toBeNull();
    expect(await getSession('current')).not.toBeNull();
    expect(mocks.set).toHaveBeenCalledTimes(3);
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
