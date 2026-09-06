import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  COACH_STATUS_LABELS,
  type ChatMessage,
  type CoachStatus,
} from '../../src/agent/schemas';
import { CoachMascot } from '../../src/components/CoachMascot';
import { deriveCoachMascotState } from '../../src/components/coach-mascot-state';
import { MathText } from '../../src/components/MathText';
import { MessageContent } from '../../src/components/MessageContent';
import { manualProblemContext } from '../../src/extraction/recognize';
import {
  PAGE_ACCESS_DENIED_MESSAGE,
  type ActiveProblemResult,
  type ProblemContext,
} from '../../src/extraction/schema';
import { errorMessage, sendExtensionRequest } from '../../src/messaging/client';
import {
  CoachServerEventSchema,
  type PublicSettings,
  type RestorableSession,
} from '../../src/messaging/schema';
import {
  DATA_USE_CONSENT_REQUIRED_MESSAGE,
  PRIVACY_POLICY_URL,
} from '../../src/privacy';
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
    'Reading the statement…',
    'Checking constraints and edge cases…',
    'Preparing to meet you where you are…',
    'Still studying this problem…',
  ],
  coaching: [
    'Reading your latest reasoning…',
    'Thinking through what would help next…',
    'Preparing a focused response…',
    'Still working on your response…',
  ],
  checking: [
    'Checking that the response stays focused…',
    'Making sure the key work stays with you…',
    'Preparing your response…',
    'Still checking the response…',
  ],
};

function statusProgressMessage(status: StatusState, now: number): string {
  const messages = statusProgress[status.kind];
  const index = Math.min(
    Math.floor(Math.max(0, now - status.startedAt) / STATUS_PROGRESS_INTERVAL_MS),
    messages.length - 1,
  );
  return messages[index] ?? messages[0] ?? 'Working…';
}

const localMessage = (content: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: 'user',
  content,
  createdAt: Date.now(),
});

const codeforcesRanks = [
  { minimum: 3_000, name: 'Legendary Grandmaster', tone: 'legendary-grandmaster' },
  { minimum: 2_600, name: 'International Grandmaster', tone: 'grandmaster' },
  { minimum: 2_400, name: 'Grandmaster', tone: 'grandmaster' },
  { minimum: 2_300, name: 'International Master', tone: 'master' },
  { minimum: 2_100, name: 'Master', tone: 'master' },
  { minimum: 1_900, name: 'Candidate Master', tone: 'candidate-master' },
  { minimum: 1_600, name: 'Expert', tone: 'expert' },
  { minimum: 1_400, name: 'Specialist', tone: 'specialist' },
  { minimum: 1_200, name: 'Pupil', tone: 'pupil' },
  { minimum: 800, name: 'Newbie', tone: 'newbie' },
] as const;

function CodeforcesRating({
  rating,
}: {
  rating: NonNullable<ProblemContext['codeforcesRating']>;
}) {
  const rank =
    codeforcesRanks.find(({ minimum }) => rating.value >= minimum) ??
    codeforcesRanks.at(-1)!;
  const estimated = rating.source === 'estimated';
  const sourceLabel = estimated
    ? 'Estimated Codeforces-equivalent rating'
    : 'Official Codeforces rating';

  return (
    <span
      className={`cf-rating cf-rating-${rank.tone}`}
      title={`${sourceLabel} · ${rank.name}`}
      aria-label={`${sourceLabel} ${rating.value}, ${rank.name}`}
    >
      CF {estimated ? '≈' : ''}
      {rating.value}
    </span>
  );
}

export default function App() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [extraction, setExtraction] = useState<ActiveProblemResult | null>(null);
  const [extracting, setExtracting] = useState(true);
  const [needsAccess, setNeedsAccess] = useState(false);
  const [acceptingDataUse, setAcceptingDataUse] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualStatement, setManualStatement] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [clock, setClock] = useState(Date.now);
  const [composer, setComposer] = useState('');
  const [status, setStatus] = useState<StatusState | null>(null);
  const [error, setError] = useState('');
  const portRef = useRef<CoachPort | null>(null);
  const connectPortRef = useRef<() => CoachPort | null>(() => null);
  const requestInFlightRef = useRef(false);
  const latestCoachReplyRef = useRef<HTMLElement | null>(null);
  const shouldScrollToCoachReplyRef = useRef(false);

  const finishRequest = useCallback(() => {
    requestInFlightRef.current = false;
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
    shouldScrollToCoachReplyRef.current = false;
    setSessionId(session.sessionId);
    setExtraction({ context: session.problem, likelyProblem: true });
    setSessionComplete(session.completed);
    setMessages(session.messages);
    setClock(Date.now());
    setExtracting(false);
  }, []);

  useEffect(() => {
    if (!shouldScrollToCoachReplyRef.current) return;

    shouldScrollToCoachReplyRef.current = false;
    if (!latestCoachReplyRef.current) return;

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    latestCoachReplyRef.current.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  }, [messages]);

  const refreshSettings = useCallback(async () => {
    try {
      const next = await sendExtensionRequest({
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
      const result = await sendExtensionRequest({
        type: 'problem:extract',
      });
      setExtraction(result);
      setManualOpen(!result.likelyProblem);
      setNeedsAccess(false);
    } catch (caught) {
      const message = errorMessage(caught, 'Could not read this page.');
      setExtraction(null);
      setManualOpen(true);
      setNeedsAccess(message === PAGE_ACCESS_DENIED_MESSAGE);
      setError(message);
    } finally {
      setExtracting(false);
    }
  }, []);

  const restoreSession = useCallback(async (): Promise<boolean> => {
    const result = await sendExtensionRequest({ type: 'session:get-active' });
    if (!result.session) return false;

    applySession(result.session);
    return true;
  }, [applySession]);

  const openSettings = () => {
    void browser.runtime
      .openOptionsPage()
      .catch((caught) => setError(errorMessage(caught, 'Could not open settings.')));
  };

  const acceptDataUse = async () => {
    setAcceptingDataUse(true);
    setError('');
    try {
      setSettings(
        await sendExtensionRequest({
          type: 'settings:accept-data-use',
        }),
      );
    } catch (caught) {
      setError(errorMessage(caught, 'Could not save your data-use choice.'));
    } finally {
      setAcceptingDataUse(false);
    }
  };

  useEffect(() => {
    // Initial loading flags already match the asynchronous initialization state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshSettings();
    void (async () => {
      try {
        if (!(await restoreSession())) await extract();
      } catch (caught) {
        setExtracting(false);
        setError(errorMessage(caught, 'Could not restore the coaching session.'));
      }
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
        setClock(now);
        setStatus((current) => ({
          kind: event.status,
          label: event.label,
          startedAt: current?.kind === event.status ? current.startedAt : now,
        }));
      } else if (event.type === 'session:ready') {
        finishRequest();
        applySession(event);
      } else if (event.type === 'coach:reply') {
        finishRequest();
        shouldScrollToCoachReplyRef.current = true;
        setMessages((value) => [...value, event.message]);
        setSessionComplete(event.completed);
      } else if (event.type === 'coach:canceled') {
        finishRequest();
        setError('');
      } else {
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
    const keepalive = window.setInterval(() => {
      try {
        portRef.current?.postMessage({ type: 'coach:keepalive' });
      } catch {
        // onDisconnect reports the lost coaching request.
      }
    }, 15_000);
    return () => window.clearInterval(keepalive);
  }, [status]);

  useEffect(() => {
    if (!status) return;
    const interval = window.setInterval(
      () => setClock(Date.now()),
      STATUS_PROGRESS_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [status]);

  const postCoachMessage = (message: unknown): void => {
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

    if (tryPost()) return;
    if (tryPost()) return;
    failRequest(
      'Could not reconnect to the coach. Reopen the panel; your conversation will be restored.',
    );
  };

  const cancelRequest = () => {
    if (!status) return;
    postCoachMessage({ type: 'coach:cancel' });
  };

  const startSession = (problem: ProblemContext) => {
    if (!settings?.hasApiKey) {
      openSettings();
      return;
    }
    if (!settings.hasDataUseConsent) {
      setError(DATA_USE_CONSENT_REQUIRED_MESSAGE);
      return;
    }
    const now = Date.now();
    setError('');
    setSessionComplete(false);
    shouldScrollToCoachReplyRef.current = false;
    setMessages([]);
    setClock(now);
    setStatus({
      kind: 'studying',
      label: COACH_STATUS_LABELS.studying,
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
    if (!content || !sessionId || status || sessionComplete) return;
    if (!settings?.hasDataUseConsent) {
      setError(DATA_USE_CONSENT_REQUIRED_MESSAGE);
      return;
    }
    const now = Date.now();
    setError('');
    setMessages((value) => [...value, localMessage(content)]);
    setComposer('');
    setClock(now);
    setStatus({
      kind: 'coaching',
      label: COACH_STATUS_LABELS.coaching,
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
      shouldScrollToCoachReplyRef.current = false;
      setMessages([]);
      setSessionComplete(false);
      finishRequest();
    } catch (caught) {
      setError(errorMessage(caught, 'Could not close the coaching session.'));
    }
  };

  const problem = extraction?.context;
  const codeforcesRating = problem?.codeforcesRating;
  const mascotState = deriveCoachMascotState({
    sessionId,
    extracting,
    status: status?.kind ?? null,
    composer,
    error,
    completed: sessionComplete,
    messageCount: messages.length,
  });

  return (
    <main className={sessionId ? 'panel-shell panel-shell-session' : 'panel-shell'}>
      <header className="panel-header">
        <div className="brand-lockup">
          <CoachMascot state={mascotState} />
          <h1>Algo Coach</h1>
        </div>
        <button className="link-button" type="button" onClick={openSettings}>
          Settings
        </button>
      </header>

      {!settings?.hasApiKey && settings !== null ? (
        <section className="notice" aria-labelledby="setup-title">
          <h2 id="setup-title">Add your API key</h2>
          <p>Your key stays in this browser profile.</p>
          <button type="button" onClick={openSettings}>
            Open settings
          </button>
        </section>
      ) : null}

      {settings?.hasApiKey && !settings.hasDataUseConsent ? (
        <section className="notice" aria-labelledby="data-use-title">
          <h2 id="data-use-title">Before coaching</h2>
          <p>
            Coaching sends the problem text and URL, your messages and pasted code, a
            private problem analysis, and—if enabled—a small learner snapshot directly
            to OpenAI using your key.
          </p>
          <p>
            Requests use <code>store: false</code> and may use OpenAI's prompt-prefix
            cache for up to 30 minutes.{' '}
            <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">
              Privacy policy
            </a>
            .
          </p>
          <button
            type="button"
            onClick={() => void acceptDataUse()}
            disabled={acceptingDataUse}
          >
            {acceptingDataUse ? 'Saving…' : 'I understand—allow OpenAI requests'}
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
                Chrome has not let the coach read this page. Reopen the panel from the
                extension icon to grant one-time access, or paste the problem below.
              </p>
            </section>
          ) : null}

          {problem ? (
            <>
              {codeforcesRating ? (
                <p className="problem-meta">
                  <CodeforcesRating rating={codeforcesRating} />
                </p>
              ) : null}
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
              <button
                type="button"
                onClick={() => startSession(problem)}
                disabled={
                  Boolean(status) || !settings?.hasApiKey || !settings.hasDataUseConsent
                }
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
              disabled={
                Boolean(status) || !settings?.hasApiKey || !settings.hasDataUseConsent
              }
            >
              Study pasted problem
            </button>
          </details>
        </section>
      ) : (
        <>
          <section className="session-heading">
            <div className="session-heading-surface">
              <div className="session-summary">
                {sessionComplete || codeforcesRating ? (
                  <p className="eyebrow">
                    {sessionComplete ? 'Solved · ' : null}
                    {codeforcesRating ? (
                      <CodeforcesRating rating={codeforcesRating} />
                    ) : null}
                  </p>
                ) : null}
                <h2>{problem?.title || 'Coaching session'}</h2>
              </div>
              <button
                className="link-button"
                type="button"
                onClick={() => void changeProblem()}
                disabled={Boolean(status)}
              >
                Change problem
              </button>
            </div>
          </section>

          <section className="conversation" aria-label="Coaching conversation">
            {messages.map((message) => (
              <article
                className={`message message-${message.role}`}
                key={message.id}
                ref={
                  message.role === 'assistant' && message.id === messages.at(-1)?.id
                    ? latestCoachReplyRef
                    : undefined
                }
              >
                <p className="message-author">
                  {message.role === 'assistant' ? 'Coach' : 'You'}
                </p>
                <MessageContent content={message.content} />
                {message.visualization ? (
                  <Whiteboard scene={message.visualization} />
                ) : null}
              </article>
            ))}
          </section>

          {sessionComplete ? (
            <section className="session-complete" role="status">
              <p>
                <strong>Optimal solution reached.</strong> The coach has closed this
                session.
              </p>
              <button type="button" onClick={() => void changeProblem()}>
                Choose another problem
              </button>
            </section>
          ) : status ? null : (
            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <label htmlFor="coach-message">What would you like to work on?</label>
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
                placeholder="Tell me your goal, share your thinking, paste code, or describe where it breaks…"
              />
              <div className="composer-actions">
                <span className="quiet">⌘/Ctrl + Enter</span>
                <button
                  type="submit"
                  disabled={!composer.trim() || !settings?.hasDataUseConsent}
                >
                  Ask the coach
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {status ? (
        <div className="status-row">
          <p className="status" aria-live="polite">
            <span className="status-dot" aria-hidden="true" />
            <span className="status-copy">
              <span className="status-heading">
                <strong>{status.label}</strong>
                <button
                  className="link-button status-stop"
                  type="button"
                  onClick={cancelRequest}
                >
                  Stop
                </button>
              </span>
              <span className="status-progress">
                {statusProgressMessage(status, clock)}
              </span>
            </span>
          </p>
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}
