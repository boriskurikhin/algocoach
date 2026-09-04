import { browser } from 'wxt/browser';
import { z } from 'zod';
import { LearnerProfileSchema, type LearnerProfile } from '../learner/schema';
import { createEmptyLearnerProfile } from '../learner/update-profile';

const SETTINGS_KEY = 'socratic-coach:settings';
const PROFILE_KEY = 'socratic-coach:learner-profile';
export const ExtensionSettingsSchema = z.object({
  apiKey: z.string().trim().max(500).default(''),
});

export type ExtensionSettings = z.infer<typeof ExtensionSettingsSchema>;

const defaultSettings: ExtensionSettings = ExtensionSettingsSchema.parse({});

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
  if (parsed.success) return parsed.data;

  const profile = createEmptyLearnerProfile();
  await browser.storage.local.set({ [PROFILE_KEY]: profile });
  return profile;
}

export async function saveLearnerProfile(
  input: LearnerProfile,
): Promise<LearnerProfile> {
  const profile = LearnerProfileSchema.parse(input);
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
