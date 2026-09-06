export const CURRENT_DATA_USE_CONSENT_VERSION = 1;

export const DATA_USE_CONSENT_REQUIRED_MESSAGE =
  'Review and accept the data-use disclosure before connecting to OpenAI.';

export const PRIVACY_POLICY_URL =
  'https://github.com/boriskurikhin/algocoach/blob/main/PRIVACY.md';

export const hasCurrentDataUseConsent = (version: number): boolean =>
  version >= CURRENT_DATA_USE_CONSENT_VERSION;
