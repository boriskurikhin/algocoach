import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  COACH_PROCESSING_LABEL,
  COACH_STEP_TIMEOUT_MINUTES,
  type ChatMessage,
  type CoachStage,
  type CoachStatus,
} from '../../src/agent/schemas';
import {
  EMPTY_SESSION_USAGE,
  SESSION_COST_ESTIMATE_NOTE,
  type SessionUsage,
} from '../../src/agent/usage';
import { MathText } from '../../src/components/MathText';
import { MessageContent } from '../../src/components/MessageContent';
import { manualProblemContext } from '../../src/extraction/recognize';
import type { ActiveProblemResult } from '../../src/extraction/run';
import type { ProblemContext } from '../../src/extraction/schema';
import {
  hasSiteAccess,
  requestSiteAccess,
  siteOriginPattern,
} from '../../src/extraction/site-access';
import { errorMessage, sendExtensionRequest } from '../../src/messaging/client';
import {
  ActiveSessionResultSchema,
  CoachServerEventSchema,
  type PublicSettings,
  type RestorableSession,
} from '../../src/messaging/schema';
import { Whiteboard } from '../../src/visualization/Whiteboard';
import './sidepanel.css';

interface StatusState {
  kind: CoachStatus;
  label: string;
  startedAt: number;
}

type CoachPort = ReturnType<typeof browser.runtime.connect>;

const STATUS_PROGRESS_INTERVAL_MS = 4_000;
const statusProgress: Record<CoachStatus, readonly string[]> = {
  studying: [
    'Reading the statement and constraints…',
    'Separating the core model from edge cases…',
    'Building a private ladder of safe questions…',
    'Still studying—hard problems can take a little longer.',
  ],
  coaching: [
    'Reading your latest reasoning…',
    'Looking for the smallest useful mismatch…',
    'Choosing one question that keeps the work with you…',
    'Still drafting one careful coaching move.',
  ],
  checking: [
    'Checking against the private answer boundary…',
    'Making sure the hint advances only one step…',
    'Removing anything too revealing or overloaded…',
    'Still checking before anything reaches you.',
  ],
  'saving-profile': ['Saving only evidence from what you demonstrated…'],
};

function statusProgressMessage(status: StatusState, now: number): string {
  const messages = statusProgress[status.kind];
  const index = Math.min(
    Math.floor(Math.max(0, now - status.startedAt) / STATUS_PROGRESS_INTERVAL_MS),
    messages.length - 1,
  );
  return messages[index] ?? messages[0] ?? 'Working…';
}

function elapsedTime(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const localMessage = (content: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: 'user',
  content,
  createdAt: Date.now(),
});

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const wholeNumber = new Intl.NumberFormat('en-US');

function estimatedCost(value: number): string {
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

function usageDetail(usage: SessionUsage): string {
  const calls = `${wholeNumber.format(usage.modelCalls)} model ${
    usage.modelCalls === 1 ? 'call' : 'calls'
  }`;
  return [
    `${wholeNumber.format(usage.inputTokens)} input`,
    `${wholeNumber.format(usage.cachedInputTokens)} cached`,
    `${wholeNumber.format(usage.cacheWriteTokens)} cache writes`,
    `${wholeNumber.format(usage.outputTokens)} output`,
    `${wholeNumber.format(usage.reasoningTokens)} reasoning`,
    calls,
    SESSION_COST_ESTIMATE_NOTE,
  ].join(' · ');
}

export default function App() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [extraction, setExtraction] = useState<ActiveProblemResult | null>(null);
  const [extracting, setExtracting] = useState(true);
  const [sitePattern, setSitePattern] = useState<string | null>(null);
  const [needsAccess, setNeedsAccess] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualStatement, setManualStatement] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stage, setStage] = useState<CoachStage>('listen');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [usage, setUsage] = useState<SessionUsage>(EMPTY_SESSION_USAGE);
  const [draft, setDraft] = useState('');
  const [composer, setComposer] = useState('');
  const [status, setStatus] = useState<StatusState | null>(null);
  const [statusClock, setStatusClock] = useState(Date.now);
  const [error, setError] = useState('');
  const portRef = useRef<CoachPort | null>(null);
  const connectPortRef = useRef<() => CoachPort | null>(() => null);
  const requestInFlightRef = useRef(false);

  const finishRequest = useCallback(() => {
    requestInFlightRef.current = false;
    setDraft('');
    setStatus(null);
  }, []);

  const failRequest = useCallback(
    (message: string) => {
      finishRequest();
      setError(message);
    },
    [finishRequest],
  );

  const applySession = useCallback((session: RestorableSession) => {
    setSessionId(session.sessionId);
    setExtraction({ context: session.problem, likelyProblem: true });
    setStage(session.stage);
    setMessages(session.messages);
    setUsage(session.usage);
    setExtracting(false);
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const next = await sendExtensionRequest<PublicSettings>({
        type: 'settings:get',
      });
      setSettings(next);
    } catch (caught) {
      setError(errorMessage(caught, 'Could not load settings.'));
    }
  }, []);

  const extract = useCallback(async () => {
    setExtracting(true);
    setError('');
    try {
      const result = await sendExtensionRequest<ActiveProblemResult>({
        type: 'problem:extract',
      });
      setExtraction(result);
      setManualOpen(!result.likelyProblem);
      setNeedsAccess(false);

      // Offer a lasting grant only while this read is riding a temporary one.
      const pattern = siteOriginPattern(result.context.source.url);
      const granted = pattern ? await hasSiteAccess(pattern) : true;
      setSitePattern(granted ? null : pattern);
    } catch (caught) {
      const message = errorMessage(caught, 'Could not read this page.');
      setExtraction(null);
      setSitePattern(null);
      setManualOpen(true);
      setNeedsAccess(message.startsWith('Page access was not granted'));
      setError(message);
    } finally {
      setExtracting(false);
    }
  }, []);

  const restoreSession = useCallback(async (): Promise<boolean> => {
    try {
      const result = ActiveSessionResultSchema.parse(
        await sendExtensionRequest<unknown>({ type: 'session:get-active' }),
      );
      if (!result.session) return false;

      applySession(result.session);
      return true;
    } catch {
      return false;
    }
  }, [applySession]);

  const grantSiteAccess = () => {
    if (!sitePattern) return;
    void requestSiteAccess(sitePattern).then((granted) => {
      if (granted) setSitePattern(null);
    });
  };

  // Chrome hides the URL until access exists, so the panel cannot name the site
  // to ask for. Hand the learner Chrome's own per-site control instead.
  const openSiteAccessSettings = () => {
    void browser.tabs.create({ url: `chrome://extensions/?id=${browser.runtime.id}` });
  };

  useEffect(() => {
    // Initial loading flags already match the asynchronous initialization state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshSettings();
    void (async () => {
      if (!(await restoreSession())) await extract();
    })();

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshSettings();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [extract, refreshSettings, restoreSession]);

  useEffect(() => {
    let disposed = false;
    let activeConnection: { port: CoachPort; detach: () => void } | null = null;

    const onMessage = (rawEvent: unknown) => {
      const parsed = CoachServerEventSchema.safeParse(rawEvent);
      if (!parsed.success) {
        if (requestInFlightRef.current) {
          failRequest('The coach sent an unreadable update. Reload it and try again.');
        }
        return;
      }
      const event = parsed.data;

      if (event.type === 'coach:status') {
        const now = Date.now();
        setStatusClock(now);
        setStatus((current) => ({
          kind: event.status,
          label: event.label,
          startedAt:
            current?.kind === event.status && current.startedAt
              ? current.startedAt
              : now,
        }));
      } else if (event.type === 'session:ready') {
        finishRequest();
        applySession(event);
      } else if (event.type === 'coach:chunk') {
        setDraft((value) => value + event.chunk);
      } else if (event.type === 'coach:reply') {
        finishRequest();
        setMessages((value) => [...value, event.message]);
        setStage(event.stage);
        setUsage(event.usage);
      } else {
        if (event.usage) setUsage(event.usage);
        failRequest(event.message);
      }
    };

    const connect = (): CoachPort | null => {
      if (disposed) return null;
      if (portRef.current) return portRef.current;

      try {
        const port = browser.runtime.connect({ name: 'socratic-coach' });
        portRef.current = port;

        const detach = () => {
          port.onMessage.removeListener(onMessage);
          port.onDisconnect.removeListener(onDisconnect);
        };
        const onDisconnect = () => {
          detach();
          const wasCurrent = portRef.current === port;
          if (activeConnection?.port === port) activeConnection = null;
          if (wasCurrent) portRef.current = null;
          if (disposed || !wasCurrent) return;

          if (requestInFlightRef.current) {
            failRequest(
              'The coaching request was interrupted. Your conversation is still here; try again.',
            );
          }
        };

        activeConnection = { port, detach };
        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(onDisconnect);
        return port;
      } catch {
        return null;
      }
    };

    connectPortRef.current = connect;

    return () => {
      disposed = true;
      connectPortRef.current = () => null;
      const connection = activeConnection;
      connection?.detach();
      if (portRef.current === connection?.port) portRef.current = null;
      connection?.port.disconnect();
    };
  }, [applySession, failRequest, finishRequest]);

  useEffect(() => {
    if (!status) return;
    const clock = window.setInterval(() => setStatusClock(Date.now()), 1_000);
    const keepalive = window.setInterval(() => {
      try {
        portRef.current?.postMessage({ type: 'coach:keepalive' });
      } catch {
        // onDisconnect reports the lost coaching request.
      }
    }, 15_000);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(keepalive);
    };
  }, [status]);

  const postCoachMessage = (message: unknown): boolean => {
    const tryPost = (): boolean => {
      const port = portRef.current ?? connectPortRef.current();
      if (!port) return false;
      try {
        port.postMessage(message);
        return true;
      } catch {
        if (portRef.current === port) portRef.current = null;
        return false;
      }
    };

    if (tryPost() || tryPost()) return true;
    failRequest(
      'Could not reconnect to the coach. Reopen the panel; your conversation will be restored.',
    );
    return false;
  };

  const startSession = (problem: ProblemContext) => {
    if (!settings?.hasApiKey) {
      void browser.runtime.openOptionsPage();
      return;
    }
    const now = Date.now();
    setError('');
    setMessages([]);
    setUsage({ ...EMPTY_SESSION_USAGE });
    setStatusClock(now);
    setStatus({
      kind: 'studying',
      label: 'Studying the problem before we talk…',
      startedAt: now,
    });
    requestInFlightRef.current = true;
    postCoachMessage({ type: 'session:start', problem });
  };

  const startManualSession = () => {
    if (manualStatement.trim().length < 100) {
      setError('Paste enough of the problem statement for the coach to study it.');
      return;
    }
    startSession(manualProblemContext(manualStatement, manualTitle));
  };

  const submit = () => {
    const content = composer.trim();
    if (!content || !sessionId || status) return;
    const now = Date.now();
    setError('');
    setMessages((value) => [...value, localMessage(content)]);
    setComposer('');
    setDraft('');
    setStatusClock(now);
    setStatus({
      kind: 'coaching',
      label: 'Choosing the smallest useful question…',
      startedAt: now,
    });
    requestInFlightRef.current = true;
    postCoachMessage({
      type: 'session:user-message',
      sessionId,
      content,
    });
  };

  const changeProblem = async () => {
    if (status || !sessionId) return;
    setError('');
    try {
      await sendExtensionRequest({
        type: 'session:clear-active',
        sessionId,
      });
      setSessionId(null);
      setMessages([]);
      setUsage({ ...EMPTY_SESSION_USAGE });
      finishRequest();
    } catch (caught) {
      setError(errorMessage(caught, 'Could not close the coaching session.'));
    }
  };

  const problem = extraction?.context;
  const sessionUsageDetail = usage.modelCalls ? usageDetail(usage) : '';

  return (
    <main className="panel-shell">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Socratic</p>
          <h1>Algo Coach</h1>
        </div>
        <button
          className="link-button"
          type="button"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          Settings
        </button>
      </header>

      {!settings?.hasApiKey && settings !== null ? (
        <section className="notice" aria-labelledby="setup-title">
          <h2 id="setup-title">Add your OpenAI key</h2>
          <p>Your key stays in extension-local storage and is sent only to OpenAI.</p>
          <button type="button" onClick={() => void browser.runtime.openOptionsPage()}>
            Open settings
          </button>
        </section>
      ) : null}

      {!sessionId ? (
        <section aria-labelledby="problem-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Current page</p>
              <h2 id="problem-title">
                {extracting ? 'Reading…' : problem?.title || 'Problem not recognized'}
              </h2>
            </div>
            <button
              className="link-button"
              type="button"
              onClick={() => void extract()}
              disabled={extracting}
            >
              Read again
            </button>
          </div>

          {needsAccess ? (
            <section className="notice">
              <p>
                Chrome has not let the coach read this site yet. Open site access
                settings, then set <strong>Site access</strong> to this site.
              </p>
              <button type="button" onClick={openSiteAccessSettings}>
                Open site access settings
              </button>
            </section>
          ) : null}

          {problem ? (
            <>
              <p className="problem-meta">
                {problem.source.site} · {Math.round(problem.confidence * 100)}%
                extraction confidence
              </p>
              <p className="problem-preview">
                <MathText
                  value={
                    problem.statement.slice(0, 320) +
                    (problem.statement.length > 320 ? '…' : '')
                  }
                />
              </p>
              {problem.warnings.map((warning) => (
                <p className="quiet" key={warning}>
                  {warning}
                </p>
              ))}
              {sitePattern ? (
                <p className="quiet">
                  This read used one-time access.{' '}
                  <button
                    className="link-button"
                    type="button"
                    onClick={grantSiteAccess}
                  >
                    Let the coach read {problem.source.host} without the icon
                  </button>
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => startSession(problem)}
                disabled={Boolean(status) || !settings?.hasApiKey}
              >
                Start coaching
              </button>
            </>
          ) : null}

          <details
            className="manual-entry"
            open={manualOpen}
            onToggle={(event) => setManualOpen(event.currentTarget.open)}
          >
            <summary>Paste a problem instead</summary>
            <label>
              Title <span className="quiet">(optional)</span>
              <input
                value={manualTitle}
                onChange={(event) => setManualTitle(event.target.value)}
                maxLength={500}
              />
            </label>
            <label>
              Problem statement
              <textarea
                value={manualStatement}
                onChange={(event) => setManualStatement(event.target.value)}
                rows={12}
                placeholder="Paste the statement, constraints, and examples…"
              />
            </label>
            <button
              type="button"
              onClick={startManualSession}
              disabled={Boolean(status) || !settings?.hasApiKey}
            >
              Study pasted problem
            </button>
          </details>
        </section>
      ) : (
        <>
          <section className="session-heading">
            <div className="session-summary">
              <p className="eyebrow">Hint stage: {stage}</p>
              <h2>{problem?.title || 'Coaching session'}</h2>
              {usage.modelCalls ? (
                <p
                  className="session-usage"
                  title={sessionUsageDetail}
                  aria-label={sessionUsageDetail}
                >
                  {compactNumber.format(usage.inputTokens + usage.outputTokens)} tokens
                  {' · '}≈{estimatedCost(usage.estimatedCostUsd)}
                </p>
              ) : null}
            </div>
            <button
              className="link-button"
              type="button"
              onClick={() => void changeProblem()}
              disabled={Boolean(status)}
            >
              Change problem
            </button>
          </section>

          <section className="conversation" aria-label="Coaching conversation">
            {messages.map((message) => (
              <article className={`message message-${message.role}`} key={message.id}>
                <p className="message-author">
                  {message.role === 'assistant' ? 'Coach' : 'You'}
                </p>
                <MessageContent content={message.content} />
                {message.visualization ? (
                  <Whiteboard scene={message.visualization} />
                ) : null}
              </article>
            ))}
            {draft ? (
              <article className="message message-assistant" aria-live="polite">
                <p className="message-author">Coach</p>
                <MessageContent content={draft} />
              </article>
            ) : null}
          </section>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label htmlFor="coach-message">What are you thinking?</label>
            <textarea
              id="coach-message"
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
              }}
              rows={6}
              placeholder="Explain your model, paste code, or describe where it breaks…"
              disabled={Boolean(status)}
            />
            <div className="composer-actions">
              <span className="quiet">⌘/Ctrl + Enter</span>
              <button type="submit" disabled={!composer.trim() || Boolean(status)}>
                Ask the coach
              </button>
            </div>
          </form>
        </>
      )}

      {status ? (
        <p className="status" aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          <span className="status-copy">
            <strong>{status.label}</strong>
            <span className="status-progress">
              {statusProgressMessage(status, statusClock)}
            </span>
            <span className="status-detail" aria-hidden="true">
              {status.kind === 'saving-profile'
                ? 'Local only'
                : `OpenAI · ${COACH_PROCESSING_LABEL} · ${
                    settings?.reasoningEffort ?? 'high'
                  } reasoning`}
              {' · '}
              {elapsedTime(status.startedAt, statusClock)} elapsed
              {status.kind === 'saving-profile'
                ? ''
                : ` · ${COACH_STEP_TIMEOUT_MINUTES}m limit`}
            </span>
          </span>
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <footer>
        <p>
          The coach protects productive struggle. It will not write the solution for
          you.
        </p>
      </footer>
    </main>
  );
}
