import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  KnowledgeLevelSchema,
  type KnowledgeEstimate,
  type KnowledgeLevel,
  type LearnerProfile,
  type TendencyEstimate,
} from '../../src/learner/schema';
import { errorMessage, sendExtensionRequest } from '../../src/messaging/client';
import type { PublicSettings, RuntimeRequest } from '../../src/messaging/schema';
import { PRIVACY_POLICY_URL } from '../../src/privacy';
import './options.css';

/** The profile requests that answer with a replacement profile. */
type ProfileMutation = Extract<
  RuntimeRequest,
  {
    type:
      | 'profile:set-enabled'
      | 'profile:reset'
      | 'profile:remove-entry'
      | 'profile:set-knowledge';
  }
>;

type AnyDimension = Extract<
  ProfileMutation,
  { type: 'profile:remove-entry' }
>['dimension'];
type KnowledgeDimension = Extract<
  ProfileMutation,
  { type: 'profile:set-knowledge' }
>['dimension'];
type TendencyDimension = Exclude<AnyDimension, KnowledgeDimension>;

const knowledgeLevels = KnowledgeLevelSchema.options;

function confidenceLabel(value: number): string {
  if (value >= 0.75) return 'high confidence';
  if (value >= 0.4) return 'medium confidence';
  return 'low confidence';
}

function ProfileSection<Estimate extends KnowledgeEstimate | TendencyEstimate>({
  heading,
  emptyText,
  entries,
  renderControls,
}: {
  heading: string;
  emptyText: string;
  entries: [string, Estimate][];
  renderControls: (key: string, estimate: Estimate) => ReactNode;
}) {
  return (
    <section className="profile-section">
      <h3>{heading}</h3>
      {entries.length === 0 ? (
        <p className="quiet">{emptyText}</p>
      ) : (
        <ul className="estimate-list">
          {entries.map(([key, estimate]) => (
            <li key={key}>
              <div>
                <strong>{key}</strong>
                <span className="estimate-meta">
                  {confidenceLabel(estimate.confidence)} · {estimate.sampleCount}{' '}
                  observation{estimate.sampleCount === 1 ? '' : 's'}
                </span>
              </div>
              {renderControls(key, estimate)}
              {estimate.evidence.at(-1) ? (
                <p className="evidence">{estimate.evidence.at(-1)?.note}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function App() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [declaredDimension, setDeclaredDimension] =
    useState<KnowledgeDimension>('languages');
  const [declaredKey, setDeclaredKey] = useState('');
  const [declaredLevel, setDeclaredLevel] = useState<KnowledgeLevel>('practicing');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextSettings, profileResponse] = await Promise.all([
        sendExtensionRequest({ type: 'settings:get' }),
        sendExtensionRequest({ type: 'profile:get' }),
      ]);
      setSettings(nextSettings);
      setProfile(profileResponse.profile);
    } catch (caught) {
      setError(errorMessage(caught, 'Could not load settings.'));
    }
  }, []);

  useEffect(() => {
    // load reaches extension I/O before updating React state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const runAction = async (fallback: string, action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught, fallback));
    } finally {
      setBusy(false);
    }
  };

  const save = (thenTest = false) =>
    runAction('Could not save settings.', async () => {
      setSettings(
        await sendExtensionRequest({
          type: 'settings:save',
          settings: apiKey.trim() ? { apiKey: apiKey.trim() } : {},
        }),
      );
      setApiKey('');
      setNotice('Settings saved locally.');

      if (thenTest) {
        await sendExtensionRequest({
          type: 'settings:test-key',
        });
        setNotice('Settings saved. The key works.');
      }
    });

  const removeKey = () =>
    runAction('Could not remove the key.', async () => {
      setSettings(await sendExtensionRequest({ type: 'settings:remove-key' }));
      setApiKey('');
      setNotice('The API key was removed.');
    });

  const acceptDataUse = () =>
    runAction('Could not save your data-use choice.', async () => {
      setSettings(
        await sendExtensionRequest({
          type: 'settings:accept-data-use',
        }),
      );
      setNotice('Data use accepted. OpenAI requests are now enabled.');
    });

  const revokeDataUse = () =>
    runAction('Could not disable OpenAI requests.', async () => {
      setSettings(
        await sendExtensionRequest({
          type: 'settings:revoke-data-use',
        }),
      );
      setNotice('OpenAI requests are disabled.');
    });

  const mutateProfile = async (
    request: ProfileMutation,
    fallback = 'Could not update the learner profile.',
  ): Promise<boolean> => {
    setError('');
    try {
      const response = await sendExtensionRequest(request);
      setProfile(response.profile);
      return true;
    } catch (caught) {
      setError(errorMessage(caught, fallback));
      return false;
    }
  };

  const setEnabled = (enabled: boolean) =>
    mutateProfile(
      { type: 'profile:set-enabled', enabled },
      'Could not update personalization.',
    );

  const removeEntry = (dimension: AnyDimension, key: string) =>
    mutateProfile({ type: 'profile:remove-entry', dimension, key });

  const setKnowledge = (
    dimension: KnowledgeDimension,
    key: string,
    level: KnowledgeLevel,
    pinned: boolean,
  ) => mutateProfile({ type: 'profile:set-knowledge', dimension, key, level, pinned });

  const addDeclaredKnowledge = async () => {
    const key = declaredKey.trim().toLowerCase();
    if (!key) return;
    if (await setKnowledge(declaredDimension, key, declaredLevel, true)) {
      setDeclaredKey('');
    }
  };

  const exportData = () =>
    runAction('Could not export local data.', async () => {
      const result = await sendExtensionRequest({
        type: 'profile:export',
      });
      const url = URL.createObjectURL(
        new Blob([result.json], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'socratic-algo-coach-data.json';
      link.click();
      URL.revokeObjectURL(url);
    });

  const resetProfile = () => {
    if (!window.confirm('Erase every learner-profile estimate?')) return;
    void mutateProfile({ type: 'profile:reset' });
  };

  const renderKnowledge = (heading: string, dimension: KnowledgeDimension) =>
    profile ? (
      <ProfileSection
        heading={heading}
        emptyText="No evidence yet."
        entries={Object.entries(profile[dimension])}
        renderControls={(key, estimate) => (
          <div className="estimate-controls">
            <select
              aria-label={`Knowledge level for ${key}`}
              value={estimate.level}
              onChange={(event) =>
                void setKnowledge(
                  dimension,
                  key,
                  event.target.value as KnowledgeLevel,
                  true,
                )
              }
            >
              {knowledgeLevels.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={estimate.pinned}
                onChange={(event) =>
                  void setKnowledge(
                    dimension,
                    key,
                    estimate.level,
                    event.target.checked,
                  )
                }
              />
              Pin
            </label>
            <button
              className="link-button"
              type="button"
              onClick={() => void removeEntry(dimension, key)}
            >
              Remove
            </button>
          </div>
        )}
      />
    ) : null;

  const renderTendencies = (heading: string, dimension: TendencyDimension) =>
    profile ? (
      <ProfileSection
        heading={heading}
        emptyText="No repeated signal yet."
        entries={Object.entries(profile[dimension])}
        renderControls={(key) => (
          <button
            className="link-button"
            type="button"
            onClick={() => void removeEntry(dimension, key)}
          >
            This is wrong—remove it
          </button>
        )}
      />
    ) : null;

  return (
    <main className="options-shell">
      <header>
        <h1>Settings</h1>
      </header>

      <section aria-labelledby="data-use-title">
        <h2 id="data-use-title">Before you connect</h2>
        <p>
          Coaching sends the active problem, your messages and pasted code, a private
          problem analysis, and—if enabled—a small learner snapshot directly to OpenAI.
          Your API key authenticates those requests.
        </p>
        <p>
          Requests use HTTPS and <code>store: false</code>. OpenAI may keep an implicit
          prompt-prefix cache for up to 30 minutes and otherwise processes data under
          its API terms. The full learner profile stays in this browser.
        </p>
        <p>
          <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">
            Read the privacy policy
          </a>
          .
        </p>
        {settings?.hasDataUseConsent ? (
          <>
            <p className="quiet">Data use accepted.</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void revokeDataUse()}
              disabled={busy}
            >
              Disable OpenAI requests
            </button>
          </>
        ) : (
          <button type="button" onClick={() => void acceptDataUse()} disabled={busy}>
            I understand—allow OpenAI requests
          </button>
        )}
      </section>

      <section aria-labelledby="connection-title">
        <h2 id="connection-title">Connection</h2>
        <p>The key is stored in this browser profile and sent only to OpenAI.</p>
        <label>
          OpenAI API key
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              settings?.hasApiKey
                ? 'A key is saved; enter a new one to replace it'
                : 'sk-…'
            }
          />
        </label>
        <div className="button-row">
          <button type="button" onClick={() => void save()} disabled={busy}>
            Save locally
          </button>
          <button
            type="button"
            onClick={() => void save(true)}
            disabled={busy || !settings?.hasDataUseConsent}
          >
            Save and test
          </button>
          {settings?.hasApiKey ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => void removeKey()}
              disabled={busy}
            >
              Remove key
            </button>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="memory-title">
        <h2 id="memory-title">Learner memory</h2>
        <p>
          Estimates are built from evidence, confidence, and recency. The coach does not
          assign intelligence, personality, or moral labels. If personalization is
          enabled, only a relevant snapshot is sent to OpenAI with coaching requests.
        </p>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={profile?.personalizationEnabled ?? false}
            onChange={(event) => void setEnabled(event.target.checked)}
          />
          Personalize coaching from this local profile
        </label>

        <details className="declare-skill">
          <summary>Tell the coach something it should know</summary>
          <div className="split-fields">
            <label>
              Kind
              <select
                value={declaredDimension}
                onChange={(event) =>
                  setDeclaredDimension(event.target.value as KnowledgeDimension)
                }
              >
                <option value="languages">Language</option>
                <option value="concepts">Concept or algorithm</option>
                <option value="competencies">Problem-solving skill</option>
              </select>
            </label>
            <label>
              Current level
              <select
                value={declaredLevel}
                onChange={(event) =>
                  setDeclaredLevel(event.target.value as KnowledgeLevel)
                }
              >
                {knowledgeLevels.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Name
            <input
              value={declaredKey}
              onChange={(event) => setDeclaredKey(event.target.value)}
              placeholder="Python, FFT, debugging invariants…"
              maxLength={100}
            />
          </label>
          <button type="button" onClick={() => void addDeclaredKnowledge()}>
            Add and pin
          </button>
        </details>

        {renderKnowledge('Languages', 'languages')}
        {renderKnowledge('Concepts and patterns', 'concepts')}
        {renderKnowledge('Problem-solving strengths', 'competencies')}
        {renderTendencies('Recurring roadblocks', 'blockers')}
        {renderTendencies('Helpful coaching styles', 'coachingPreferences')}

        <div className="button-row profile-actions">
          <button type="button" onClick={() => void exportData()} disabled={busy}>
            Export local data
          </button>
          <button
            type="button"
            className="secondary-button danger-button"
            onClick={() => void resetProfile()}
          >
            Reset learner profile
          </button>
        </div>
      </section>

      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}
