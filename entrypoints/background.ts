import { browser } from 'wxt/browser';
import { createOpenAIClient, safeOpenAIError } from '../src/agent/openai-client';
import { respondToLearner, startCoachingSession } from '../src/agent/orchestrator';
import type { CoachStatus } from '../src/agent/schemas';
import { extractActiveProblem } from '../src/extraction/run';
import { MAX_EVIDENCE, type LearnerProfile } from '../src/learner/schema';
import {
  ActiveSessionResultSchema,
  CoachClientMessageSchema,
  CoachServerEventSchema,
  RuntimeRequestSchema,
  RuntimeResponseSchema,
  type PublicSettings,
  type RuntimeRequest,
  type RuntimeResponse,
} from '../src/messaging/schema';
import {
  exportLocalData,
  getLearnerProfile,
  getSettings,
  removeApiKey,
  resetLearnerProfile,
  restrictLocalStorageToTrustedContexts,
  saveLearnerProfile,
  saveSettings,
  setPersonalizationEnabled,
  type ExtensionSettings,
} from '../src/storage/local';
import { clearActiveSession, getActiveSession } from '../src/storage/session';

function publicSettings(settings: ExtensionSettings): PublicSettings {
  return {
    hasApiKey: Boolean(settings.apiKey),
    model: settings.model,
    reasoningEffort: settings.reasoningEffort,
    reasoningMode: settings.reasoningMode,
  };
}

const success = (data: unknown): RuntimeResponse =>
  RuntimeResponseSchema.parse({ ok: true, data });

const failure = (error: string): RuntimeResponse =>
  RuntimeResponseSchema.parse({ ok: false, error });

async function editProfileEntry(
  request: Extract<
    RuntimeRequest,
    { type: 'profile:remove-entry' | 'profile:set-knowledge' }
  >,
): Promise<{ profile: LearnerProfile }> {
  const profile = await getLearnerProfile();
  const now = Date.now();

  if (request.type === 'profile:remove-entry') {
    delete profile[request.dimension][request.key];
  } else {
    const collection = profile[request.dimension];
    const key = request.key.trim().toLowerCase();
    const previous = collection[key];
    collection[key] = {
      level: request.level,
      confidence: 1,
      sampleCount: Math.max(1, previous?.sampleCount ?? 0),
      demonstratedCount: previous?.demonstratedCount ?? 0,
      lastObservedAt: now,
      pinned: request.pinned,
      evidence: [
        ...(previous?.evidence ?? []),
        {
          id: `${now}-learner-correction`.slice(0, 100),
          at: now,
          type: 'self-reported' as const,
          note: 'The learner corrected this estimate in Settings.',
          supports: true,
        },
      ].slice(-MAX_EVIDENCE),
    };
  }

  profile.updatedAt = now;
  return { profile: await saveLearnerProfile(profile) };
}

const handlers: {
  [Type in RuntimeRequest['type']]: (
    request: Extract<RuntimeRequest, { type: Type }>,
  ) => Promise<unknown>;
} = {
  'settings:get': async () => publicSettings(await getSettings()),
  'settings:save': async (request) =>
    publicSettings(await saveSettings(request.settings)),
  'settings:remove-key': async () => publicSettings(await removeApiKey()),
  'settings:test-key': async () => {
    await createOpenAIClient(await getSettings()).models.list();
    return { connected: true };
  },
  'problem:extract': () => extractActiveProblem(),
  'session:get-active': async () => {
    const session = await getActiveSession();
    return ActiveSessionResultSchema.parse({
      session: session
        ? {
            sessionId: session.id,
            problem: session.problem,
            stage: session.stage,
            messages: session.messages,
          }
        : null,
    });
  },
  'session:clear-active': async (request) => {
    await clearActiveSession(request.sessionId);
    return {};
  },
  'profile:get': async () => ({ profile: await getLearnerProfile() }),
  'profile:set-enabled': async (request) => ({
    profile: await setPersonalizationEnabled(request.enabled),
  }),
  'profile:reset': async () => ({ profile: await resetLearnerProfile() }),
  'profile:export': async () => ({ json: await exportLocalData() }),
  'profile:remove-entry': editProfileEntry,
  'profile:set-knowledge': editProfileEntry,
};

/**
 * Reports coaching stages and rate-limits repeated model activity updates.
 */
function createStatusReporter(post: (event: unknown) => void) {
  let current = { status: 'studying' as CoachStatus, label: 'Working…' };
  let lastActivityAt = 0;

  return {
    onStatus: (status: CoachStatus, label: string): void => {
      current = { status, label };
      lastActivityAt = Date.now();
      post({ type: 'coach:status', status, label });
    },
    onModelActivity: (): void => {
      const now = Date.now();
      if (now - lastActivityAt < 10_000) return;
      lastActivityAt = now;
      post({ type: 'coach:status', ...current });
    },
  };
}

export default defineBackground(() => {
  const extensionOrigin = browser.runtime.getURL('');
  const fromExtension = (url: string | undefined): boolean =>
    Boolean(url?.startsWith(extensionOrigin));

  void restrictLocalStorageToTrustedContexts();
  void browser.storage.session
    .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch(() => undefined);
  // Chrome persists panel behavior across extension reloads, and while it opens
  // the panel itself action.onClicked never fires, so the click grants no page
  // access (crbug.com/40916430). Clear it, then open the panel from the click.
  void browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch(() => undefined);

  browser.action.onClicked.addListener((tab) => {
    void browser.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  });

  browser.runtime.onMessage.addListener(async (rawRequest, sender) => {
    if (!fromExtension(sender.url)) {
      return failure('This request is not allowed from a webpage.');
    }

    const parsed = RuntimeRequestSchema.safeParse(rawRequest);
    if (!parsed.success) return failure('The extension received an invalid request.');

    try {
      const handle = handlers[parsed.data.type] as (
        request: RuntimeRequest,
      ) => Promise<unknown>;
      return success(await handle(parsed.data));
    } catch (error) {
      return failure(safeOpenAIError(error));
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'socratic-coach' || !fromExtension(port.sender?.url)) {
      port.disconnect();
      return;
    }

    let busy = false;
    let activeRequest: AbortController | null = null;
    const post = (event: unknown): void => {
      const parsed = CoachServerEventSchema.safeParse(event);
      if (!parsed.success) return;
      try {
        port.postMessage(parsed.data);
      } catch {
        // onDisconnect aborts work after the panel closes.
      }
    };

    port.onMessage.addListener((rawMessage) => {
      const parsed = CoachClientMessageSchema.safeParse(rawMessage);
      if (!parsed.success) {
        post({ type: 'coach:error', message: 'Invalid coaching request.' });
        return;
      }
      const requestMessage = parsed.data;
      if (requestMessage.type === 'coach:keepalive') return;
      if (busy) {
        post({
          type: 'coach:error',
          message: 'Please wait for the current coaching response.',
        });
        return;
      }

      busy = true;
      const request = new AbortController();
      activeRequest = request;
      void (async () => {
        try {
          const settings = await getSettings();
          const { onStatus, onModelActivity } = createStatusReporter(post);

          if (requestMessage.type === 'session:start') {
            const { session, learnerSnapshot } = await startCoachingSession({
              problem: requestMessage.problem,
              settings,
              onStatus,
              onModelActivity,
              signal: request.signal,
            });
            post({
              type: 'session:ready',
              sessionId: session.id,
              problem: session.problem,
              stage: session.stage,
              messages: session.messages,
              learnerSnapshot,
            });
            return;
          }

          const { session, message } = await respondToLearner({
            sessionId: requestMessage.sessionId,
            content: requestMessage.content,
            settings,
            onStatus,
            onModelActivity,
            signal: request.signal,
          });
          for (const chunk of message.content.match(/[\s\S]{1,36}/g) ?? [
            message.content,
          ]) {
            post({ type: 'coach:chunk', sessionId: session.id, chunk });
          }
          post({
            type: 'coach:reply',
            sessionId: session.id,
            message,
            stage: session.stage,
          });
        } catch (error) {
          post({ type: 'coach:error', message: safeOpenAIError(error) });
        } finally {
          if (activeRequest === request) activeRequest = null;
          busy = false;
        }
      })();
    });
    port.onDisconnect.addListener(() => activeRequest?.abort());
  });
});
