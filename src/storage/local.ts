import { browser } from 'wxt/browser';
import { z } from 'zod';
import { LearnerProfileSchema, type LearnerProfile } from '../learner/schema';
import { createEmptyLearnerProfile } from '../learner/update-profile';
import { serializedByteLength } from './size';

const SETTINGS_KEY = 'socratic-coach:settings';
const PROFILE_KEY = 'socratic-coach:learner-profile';
export const MAX_AUTO_PROFILE_ENTRIES = 500;
export const MAX_PROFILE_STORAGE_BYTES = 2 * 1024 * 1024;
const PROFILE_COLLECTIONS = [
  'languages',
  'concepts',
  'competencies',
  'blockers',
  'coachingPreferences',
] as const;
export const ExtensionSettingsSchema = z.object({
  apiKey: z.string().trim().max(500).default(''),
});

export type ExtensionSettings = z.infer<typeof ExtensionSettingsSchema>;

const defaultSettings: ExtensionSettings = ExtensionSettingsSchema.parse({});

type ProfileCollection = (typeof PROFILE_COLLECTIONS)[number];
type ProfileEstimate = LearnerProfile[ProfileCollection][string];

interface ProfileEntry {
  collection: ProfileCollection;
  key: string;
  estimate: ProfileEstimate;
}

function profileEntries(profile: LearnerProfile): ProfileEntry[] {
  return PROFILE_COLLECTIONS.flatMap((collection) =>
    Object.entries(profile[collection]).map(([key, estimate]) => ({
      collection,
      key,
      estimate,
    })),
  );
}

const oldestFirst = (left: ProfileEntry, right: ProfileEntry): number =>
  left.estimate.lastObservedAt - right.estimate.lastObservedAt ||
  left.estimate.confidence - right.estimate.confidence ||
  left.estimate.sampleCount - right.estimate.sampleCount ||
  left.key.localeCompare(right.key);

function removeProfileEntry(profile: LearnerProfile, entry: ProfileEntry): void {
  delete profile[entry.collection][entry.key];
}

function exceedsProfileLimits(
  profile: LearnerProfile,
  maxAutoEntries: number,
  maxBytes: number,
): boolean {
  const automaticEntryCount = profileEntries(profile).filter(
    ({ estimate }) => !estimate.pinned,
  ).length;
  return (
    automaticEntryCount > maxAutoEntries || serializedByteLength(profile) > maxBytes
  );
}

function trimEvidence(
  profile: LearnerProfile,
  maxBytes: number,
  minimumEvidence: (entry: ProfileEntry) => number,
): void {
  let estimatedBytes = serializedByteLength(profile);
  if (estimatedBytes <= maxBytes) return;

  const candidates = profileEntries(profile)
    .flatMap((entry) => {
      const removableCount = Math.max(
        0,
        entry.estimate.evidence.length - minimumEvidence(entry),
      );
      return entry.estimate.evidence
        .slice(0, removableCount)
        .map((evidence) => ({ entry, evidence }));
    })
    .sort(
      (left, right) =>
        Number(left.entry.estimate.pinned) - Number(right.entry.estimate.pinned) ||
        left.evidence.at - right.evidence.at,
    );

  for (const { entry, evidence } of candidates) {
    if (estimatedBytes <= maxBytes) break;
    const index = entry.estimate.evidence.indexOf(evidence);
    if (index < 0) continue;
    const separatorBytes = entry.estimate.evidence.length > 1 ? 1 : 0;
    entry.estimate.evidence.splice(index, 1);
    estimatedBytes -= serializedByteLength(evidence) + separatorBytes;
  }
}

/**
 * Keep automatically inferred memory bounded while preserving explicit learner
 * corrections. Under byte pressure, old evidence is discarded before an
 * aggregate estimate, and old unpinned estimates are discarded before pinned
 * ones.
 */
export function compactLearnerProfile(
  input: LearnerProfile,
  limits: { maxAutoEntries?: number; maxBytes?: number } = {},
): LearnerProfile {
  const parsed = LearnerProfileSchema.parse(input);
  const maxAutoEntries = limits.maxAutoEntries ?? MAX_AUTO_PROFILE_ENTRIES;
  const maxBytes = limits.maxBytes ?? MAX_PROFILE_STORAGE_BYTES;
  if (!exceedsProfileLimits(parsed, maxAutoEntries, maxBytes)) return parsed;

  const profile = structuredClone(parsed);
  const automaticEntries = profileEntries(profile)
    .filter(({ estimate }) => !estimate.pinned)
    .sort(oldestFirst);

  automaticEntries
    .slice(0, Math.max(0, automaticEntries.length - maxAutoEntries))
    .forEach((entry) => removeProfileEntry(profile, entry));

  // Preserve a short audit trail before dropping entire inferred estimates.
  trimEvidence(profile, maxBytes, (entry) => (entry.estimate.pinned ? 1 : 2));

  if (serializedByteLength(profile) > maxBytes) {
    const removable = profileEntries(profile)
      .filter(({ estimate }) => !estimate.pinned)
      .sort(oldestFirst);
    let estimatedBytes = serializedByteLength(profile);
    for (const entry of removable) {
      if (estimatedBytes <= maxBytes) break;
      const separatorBytes = Object.keys(profile[entry.collection]).length > 1 ? 1 : 0;
      const entryBytes =
        serializedByteLength({ [entry.key]: entry.estimate }) - 2 + separatorBytes;
      removeProfileEntry(profile, entry);
      estimatedBytes -= entryBytes;
    }
  }

  // An unusually large set of pinned corrections keeps its aggregate values,
  // but evidence may still need to yield to Chrome's hard storage quota.
  trimEvidence(profile, maxBytes, () => 0);
  return LearnerProfileSchema.parse(profile);
}

export async function restrictLocalStorageToTrustedContexts(): Promise<void> {
  try {
    await browser.storage.local.setAccessLevel({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
  } catch {
    // Firefox and older Chromium builds may not expose setAccessLevel.
  }
}

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  const parsed = ExtensionSettingsSchema.safeParse(result[SETTINGS_KEY]);
  return parsed.success ? parsed.data : defaultSettings;
}

export async function saveSettings(
  input: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const current = await getSettings();
  const settings = ExtensionSettingsSchema.parse({ ...current, ...input });
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

export async function removeApiKey(): Promise<ExtensionSettings> {
  return saveSettings({ apiKey: '' });
}

export async function getLearnerProfile(): Promise<LearnerProfile> {
  const result = await browser.storage.local.get(PROFILE_KEY);
  const parsed = LearnerProfileSchema.safeParse(result[PROFILE_KEY]);
  if (parsed.success) {
    if (
      !exceedsProfileLimits(
        parsed.data,
        MAX_AUTO_PROFILE_ENTRIES,
        MAX_PROFILE_STORAGE_BYTES,
      )
    ) {
      return parsed.data;
    }
    const compacted = compactLearnerProfile(parsed.data);
    try {
      await browser.storage.local.set({ [PROFILE_KEY]: compacted });
    } catch {
      // Return the bounded in-memory profile even if an old oversized value
      // cannot be replaced yet.
    }
    return compacted;
  }

  const profile = createEmptyLearnerProfile();
  await browser.storage.local.set({ [PROFILE_KEY]: profile });
  return profile;
}

export async function saveLearnerProfile(
  input: LearnerProfile,
): Promise<LearnerProfile> {
  const profile = compactLearnerProfile(input);
  await browser.storage.local.set({ [PROFILE_KEY]: profile });
  return profile;
}

export async function resetLearnerProfile(): Promise<LearnerProfile> {
  const profile = createEmptyLearnerProfile();
  await browser.storage.local.set({ [PROFILE_KEY]: profile });
  return profile;
}

export async function setPersonalizationEnabled(
  enabled: boolean,
): Promise<LearnerProfile> {
  const profile = await getLearnerProfile();
  return saveLearnerProfile({
    ...profile,
    personalizationEnabled: enabled,
    updatedAt: Date.now(),
  });
}

export async function exportLocalData(): Promise<string> {
  const [settings, learnerProfile] = await Promise.all([
    getSettings(),
    getLearnerProfile(),
  ]);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      settings: {
        hasApiKey: Boolean(settings.apiKey),
      },
      learnerProfile,
    },
    null,
    2,
  );
}
