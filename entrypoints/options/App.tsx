import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  KnowledgeLevelSchema,
  LearnerProfileSchema,
  type KnowledgeEstimate,
  type KnowledgeLevel,
  type LearnerProfile,
  type TendencyEstimate,
} from '../../src/learner/schema';
import { errorMessage, sendExtensionRequest } from '../../src/messaging/client';
import type { PublicSettings, RuntimeRequest } from '../../src/messaging/schema';
import type { ExtensionSettings } from '../../src/storage/local';
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

interface ProfileResponse {
  profile: LearnerProfile;
}

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
  const [reasoningEffort, setReasoningEffort] =
    useState<ExtensionSettings['reasoningEffort']>('high');
  const [reasoningMode, setReasoningMode] =
    useState<ExtensionSettings['reasoningMode']>('standard');
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
        sendExtensionRequest<PublicSettings>({ type: 'settings:get' }),
        sendExtensionRequest<ProfileResponse>({ type: 'profile:get' }),
      ]);
      setSettings(nextSettings);
      setReasoningEffort(nextSettings.reasoningEffort);
      setReasoningMode(nextSettings.reasoningMode);
      setProfile(LearnerProfileSchema.parse(profileResponse.profile));
    } catch (caught) {
      setError(errorMessage(caught, 'Could not load settings.'));
    }
  }, []);

  useEffect(() => {
    // load reaches extension I/O before updating React state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const runSettingsAction = async (fallback: string, action: () => Promise<void>) => {
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
    runSettingsAction('Could not save settings.', async () => {
      setSettings(
        await sendExtensionRequest<PublicSettings>({
          type: 'settings:save',
          settings: {
            reasoningEffort,
            reasoningMode,
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          },
        }),
      );
      setApiKey('');
      setNotice('Settings saved locally.');

      if (thenTest) {
        await sendExtensionRequest<{ connected: boolean }>({
          type: 'settings:test-key',
        });
        setNotice('Settings saved. OpenAI accepted the key.');
      }
    });

  const removeKey = () =>
    runSettingsAction('Could not remove the key.', async () => {
      setSettings(
        await sendExtensionRequest<PublicSettings>({ type: 'settings:remove-key' }),
      );
      setApiKey('');
      setNotice('The API key was removed.');
    });

  const mutateProfile = async (
    request: ProfileMutation,
    fallback = 'Could not update the learner profile.',
  ) => {
    try {
      const response = await sendExtensionRequest<ProfileResponse>(request);
      setProfile(LearnerProfileSchema.parse(response.profile));
    } catch (caught) {
      setError(errorMessage(caught, fallback));
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
    await setKnowledge(declaredDimension, key, declaredLevel, true);
    setDeclaredKey('');
  };

  const exportData = async () => {
    const result = await sendExtensionRequest<{ json: string }>({
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
  };

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
        <p className="eyebrow">Socratic Algo Coach</p>
        <h1>Settings</h1>
        <p>
          Two things live here: your connection to OpenAI and the fallible memory the
          coach uses to meet you where you are.
        </p>
      </header>

      <section aria-labelledby="openai-title">
        <h2 id="openai-title">OpenAI</h2>
        <p>
          The key is stored in Chrome extension-local storage. It is recoverable by
          someone with access to your browser profile, and is sent only to OpenAI.
        </p>
        <label>
          API key
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
        <p className="quiet">Model: GPT-5.6 Sol · Processing: Fast (2× token price)</p>
        <div className="split-fields">
          <label>
            Reasoning mode
            <select
              value={reasoningMode}
              onChange={(event) =>
                setReasoningMode(
                  event.target.value as ExtensionSettings['reasoningMode'],
                )
              }
            >
              <option value="standard">Standard</option>
              <option value="pro">Pro</option>
            </select>
          </label>
          <label>
            Reasoning effort
            <select
              value={reasoningEffort}
              onChange={(event) =>
                setReasoningEffort(
                  event.target.value as ExtensionSettings['reasoningEffort'],
                )
              }
            >
              {['high', 'xhigh', 'max'].map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => void save()} disabled={busy}>
            Save locally
          </button>
          <button type="button" onClick={() => void save(true)} disabled={busy}>
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
          assign intelligence, personality, or moral labels.
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
          <button type="button" onClick={() => void exportData()}>
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
        <p className="quiet">
          Only a small relevant snapshot is sent to OpenAI with a coaching request. Raw
          evidence and unrelated profile entries stay local.
        </p>
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
