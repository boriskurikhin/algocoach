import { browser } from 'wxt/browser';
import { createOpenAIClient, safeOpenAIError } from '../src/agent/openai-client';
import { respondToLearner, startCoachingSession } from '../src/agent/orchestrator';
import type { CoachStatus } from '../src/agent/schemas';
import { extractActiveProblem } from '../src/extraction/run';
import { applyKnowledgeCorrection } from '../src/learner/update-profile';
import {
  CoachClientMessageSchema,
  CoachServerEventSchema,
  RuntimeRequestSchema,
  RuntimeResponseSchema,
  toRestorableSession,
  type PublicSettings,
  type RuntimeRequest,
  type RuntimeResult,
  type RuntimeResponse,
} from '../src/messaging/schema';
import {
  DATA_USE_CONSENT_REQUIRED_MESSAGE,
  hasCurrentDataUseConsent,
} from '../src/privacy';
import {
  acceptCurrentDataUse,
  exportLocalData,
  getLearnerProfile,
  getSettings,
  removeApiKey,
  resetLearnerProfile,
  restrictLocalStorageToTrustedContexts,
  revokeDataUseConsent,
  saveLearnerProfile,
  saveSettings,
  setPersonalizationEnabled,
  type ExtensionSettings,
} from '../src/storage/local';
import { clearActiveSession, getActiveSession } from '../src/storage/session';

function publicSettings(settings: ExtensionSettings): PublicSettings {
  return {
    hasApiKey: Boolean(settings.apiKey),
    hasDataUseConsent: hasCurrentDataUseConsent(settings.dataUseConsentVersion),
  };
}

function requireDataUseConsent(settings: ExtensionSettings): void {
  if (!hasCurrentDataUseConsent(settings.dataUseConsentVersion)) {
    throw new Error(DATA_USE_CONSENT_REQUIRED_MESSAGE);
  }
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
): Promise<RuntimeResult<'profile:remove-entry'>> {
  const profile = await getLearnerProfile();

  if (request.type === 'profile:set-knowledge') {
    return {
      profile: await saveLearnerProfile(applyKnowledgeCorrection(profile, request)),
    };
  }

  const updated = structuredClone(profile);
  delete updated[request.dimension][request.key];
  updated.updatedAt = Date.now();
  return { profile: await saveLearnerProfile(updated) };
}

type RuntimeHandlers = {
  [Type in RuntimeRequest['type']]: (
    request: Extract<RuntimeRequest, { type: Type }>,
  ) => Promise<RuntimeResult<Type>>;
};

const handlers: RuntimeHandlers = {
  'settings:get': async () => publicSettings(await getSettings()),
  'settings:save': async (request) =>
    publicSettings(await saveSettings(request.settings)),
  'settings:accept-data-use': async () => publicSettings(await acceptCurrentDataUse()),
  'settings:revoke-data-use': async () => publicSettings(await revokeDataUseConsent()),
  'settings:remove-key': async () => publicSettings(await removeApiKey()),
  'settings:test-key': async () => {
    const settings = await getSettings();
    requireDataUseConsent(settings);
    await createOpenAIClient(settings).models.list();
    return { connected: true };
  },
  'problem:extract': () => extractActiveProblem(),
  'session:get-active': async () => {
    const session = await getActiveSession();
    return {
      session: session ? toRestorableSession(session) : null,
    };
  },
  'session:clear-active': async (request) => {
    await clearActiveSession(request.sessionId);
    return null;
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

function handleRuntimeRequest<Type extends RuntimeRequest['type']>(
  request: Extract<RuntimeRequest, { type: Type }>,
): Promise<RuntimeResult<Type>> {
  return handlers[request.type](request);
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
      return success(await handleRuntimeRequest(parsed.data));
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
    let cancelRequested = false;
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
      if (requestMessage.type === 'coach:cancel') {
        if (activeRequest) {
          cancelRequested = true;
          activeRequest.abort();
        }
        return;
      }
      if (busy) {
        post({
          type: 'coach:error',
          message: 'Please wait for the current coaching response.',
        });
        return;
      }

      busy = true;
      cancelRequested = false;
      const request = new AbortController();
      activeRequest = request;
      void (async () => {
        try {
          const settings = await getSettings();
          requireDataUseConsent(settings);
          const onStatus = (status: CoachStatus, label: string) =>
            post({ type: 'coach:status', status, label });

          if (requestMessage.type === 'session:start') {
            const session = await startCoachingSession({
              problem: requestMessage.problem,
              settings,
              onStatus,
              signal: request.signal,
            });
            if (request.signal.aborted) return;
            post({
              type: 'session:ready',
              ...toRestorableSession(session),
            });
            return;
          }

          const { session, message } = await respondToLearner({
            sessionId: requestMessage.sessionId,
            content: requestMessage.content,
            settings,
            onStatus,
            signal: request.signal,
          });
          if (request.signal.aborted) return;
          post({
            type: 'coach:reply',
            sessionId: session.id,
            message,
            completed: session.completed,
          });
        } catch (error) {
          if (!request.signal.aborted) {
            post({
              type: 'coach:error',
              message: safeOpenAIError(error),
            });
          }
        } finally {
          if (cancelRequested && request.signal.aborted) {
            post({ type: 'coach:canceled' });
          }
          if (activeRequest === request) activeRequest = null;
          busy = false;
          cancelRequested = false;
        }
      })();
    });
    port.onDisconnect.addListener(() => activeRequest?.abort());
  });
});
