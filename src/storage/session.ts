import { browser } from 'wxt/browser';
import { z } from 'zod';
import { CoachingSessionSchema, type CoachingSession } from '../agent/schemas';

const SESSIONS_KEY = 'socratic-coach:sessions';
const ACTIVE_SESSION_KEY = 'socratic-coach:active-session';
const SessionsSchema = z.record(z.string(), CoachingSessionSchema);
const ActiveSessionIdSchema = z.string().min(1).max(100).nullable();
const MAX_SESSIONS = 10;

async function readSessions(): Promise<Record<string, CoachingSession>> {
  const result = await browser.storage.session.get(SESSIONS_KEY);
  const parsed = SessionsSchema.safeParse(result[SESSIONS_KEY]);
  return parsed.success ? parsed.data : {};
}

const newestFirst = (sessions: Record<string, CoachingSession>) =>
  Object.values(sessions).sort((left, right) => right.updatedAt - left.updatedAt);

export async function getSession(sessionId: string): Promise<CoachingSession | null> {
  const sessions = await readSessions();
  return sessions[sessionId] ?? null;
}

export async function getActiveSession(): Promise<CoachingSession | null> {
  const [sessions, activeResult] = await Promise.all([
    readSessions(),
    browser.storage.session.get(ACTIVE_SESSION_KEY),
  ]);
  const activeId = ActiveSessionIdSchema.safeParse(activeResult[ACTIVE_SESSION_KEY]);

  if (activeId.success) {
    return activeId.data ? (sessions[activeId.data] ?? null) : null;
  }

  // Sessions created before the active pointer was introduced are migrated by
  // treating the most recently updated one as the open conversation.
  return newestFirst(sessions)[0] ?? null;
}

export async function saveSession(input: CoachingSession): Promise<CoachingSession> {
  const session = CoachingSessionSchema.parse(input);
  const sessions = await readSessions();
  sessions[session.id] = session;

  const retained = Object.fromEntries(
    newestFirst(sessions)
      .slice(0, MAX_SESSIONS)
      .map((saved) => [saved.id, saved] as const),
  );
  await browser.storage.session.set({
    [SESSIONS_KEY]: retained,
    [ACTIVE_SESSION_KEY]: session.id,
  });
  return session;
}

export async function clearActiveSession(sessionId: string): Promise<void> {
  if ((await getActiveSession())?.id === sessionId) {
    await browser.storage.session.set({ [ACTIVE_SESSION_KEY]: null });
  }
}
