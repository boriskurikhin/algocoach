import { browser } from 'wxt/browser';
import { z } from 'zod';
import {
  CoachingSessionSchema,
  type ChatMessage,
  type CoachingSession,
} from '../agent/schemas';
import { serializedByteLength } from './size';

const SESSIONS_KEY = 'socratic-coach:sessions';
const ACTIVE_SESSION_KEY = 'socratic-coach:active-session';
const ActiveSessionIdSchema = z.string().min(1).max(100).nullable();
const MAX_SESSIONS = 10;
export const MAX_SINGLE_SESSION_BYTES = 2 * 1024 * 1024;
export const MAX_SESSION_STORAGE_BYTES = 4 * 1024 * 1024;

async function readSessions(): Promise<Record<string, CoachingSession>> {
  const result = await browser.storage.session.get(SESSIONS_KEY);
  const stored = result[SESSIONS_KEY];
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};

  return Object.fromEntries(
    Object.entries(stored).flatMap(([id, value]) => {
      const parsed = CoachingSessionSchema.safeParse(value);
      return parsed.success ? [[id, parsed.data]] : [];
    }),
  );
}

const newestFirst = (sessions: Record<string, CoachingSession>) =>
  Object.values(sessions).sort((left, right) => right.updatedAt - left.updatedAt);

function minimizeProblemCopies(
  problem: CoachingSession['problem'],
): CoachingSession['problem'] {
  const minimized = structuredClone(problem);
  delete minimized.input;
  delete minimized.output;
  minimized.constraints = [];
  minimized.samples = [];
  minimized.sections = [];
  return minimized;
}

const withoutVisualization = (message: ChatMessage): ChatMessage => ({
  id: message.id,
  role: message.role,
  content: message.content,
  createdAt: message.createdAt,
});

function compactSession(input: CoachingSession): CoachingSession {
  let session = CoachingSessionSchema.parse(input);
  if (serializedByteLength(session) <= MAX_SINGLE_SESSION_BYTES) return session;

  // These structured fields duplicate the statement and are not used by the
  // coach or restored side panel. Keep them for ordinary sessions, but let
  // redundant copies yield before conversation history under size pressure.
  session = CoachingSessionSchema.parse({
    ...session,
    problem: minimizeProblemCopies(session.problem),
  });
  if (serializedByteLength(session) <= MAX_SINGLE_SESSION_BYTES) return session;

  const withoutMessages = { ...session, messages: [] };
  let estimatedBytes = serializedByteLength(withoutMessages);
  const messages: ChatMessage[] = [];
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    let message = session.messages[index];
    if (!message) continue;
    const separatorBytes = messages.length > 0 ? 1 : 0;
    let messageBytes = serializedByteLength(message) + separatorBytes;
    if (
      estimatedBytes + messageBytes > MAX_SINGLE_SESSION_BYTES &&
      message.visualization
    ) {
      message = withoutVisualization(message);
      messageBytes = serializedByteLength(message) + separatorBytes;
    }
    if (
      messages.length >= 1 &&
      estimatedBytes + messageBytes > MAX_SINGLE_SESSION_BYTES
    ) {
      break;
    }
    messages.unshift(message);
    estimatedBytes += messageBytes;
  }

  return CoachingSessionSchema.parse({ ...session, messages });
}

function retainWithinBudget(
  current: CoachingSession,
  sessions: Record<string, CoachingSession>,
): Record<string, CoachingSession> {
  const ordered = [
    current,
    ...newestFirst(sessions).filter(({ id }) => id !== current.id),
  ];
  const retained: Record<string, CoachingSession> = {};
  let retainedBytes = serializedByteLength(retained);
  let retainedCount = 0;

  for (const candidateInput of ordered) {
    if (retainedCount >= MAX_SESSIONS) break;
    const candidate = compactSession(candidateInput);
    const candidateBytes =
      serializedByteLength({ [candidate.id]: candidate }) -
      2 +
      (retainedCount > 0 ? 1 : 0);
    if (
      retainedCount > 0 &&
      retainedBytes + candidateBytes > MAX_SESSION_STORAGE_BYTES
    ) {
      continue;
    }
    retained[candidate.id] = candidate;
    retainedBytes += candidateBytes;
    retainedCount += 1;
  }
  return retained;
}

const isQuotaError = (error: unknown): boolean => /quota/i.test(String(error));

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
  const session = compactSession(input);
  const sessions = await readSessions();
  sessions[session.id] = session;

  const retained = retainWithinBudget(session, sessions);
  try {
    await browser.storage.session.set({
      [SESSIONS_KEY]: retained,
      [ACTIVE_SESSION_KEY]: session.id,
    });
  } catch (error) {
    if (!isQuotaError(error) || Object.keys(retained).length === 1) throw error;
    // Chrome estimates in-memory session usage differently from serialized
    // bytes. On quota rejection, retain the active session and evict history.
    await browser.storage.session.set({
      [SESSIONS_KEY]: { [session.id]: session },
      [ACTIVE_SESSION_KEY]: session.id,
    });
  }
  return session;
}

export async function clearActiveSession(sessionId: string): Promise<void> {
  if ((await getActiveSession())?.id === sessionId) {
    await browser.storage.session.set({ [ACTIVE_SESSION_KEY]: null });
  }
}
