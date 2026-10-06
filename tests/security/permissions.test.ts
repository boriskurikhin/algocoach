import { describe, expect, it } from 'vitest';
import {
  CoachServerEventSchema,
  RuntimeResultSchemas,
} from '../../src/messaging/schema';
import extensionConfig from '../../wxt.config';
import {
  restorableSessionFixture,
  sessionFixture,
  sessionReadyFixture,
} from '../fixtures/domain';

describe('extension trust boundaries', () => {
  it('requests temporary page access and only the OpenAI network origin', () => {
    expect(extensionConfig.manifest).toHaveProperty('permissions', [
      'activeTab',
      'scripting',
      'sidePanel',
      'storage',
    ]);
    expect(extensionConfig.manifest).toHaveProperty('host_permissions', [
      'https://api.openai.com/*',
    ]);
  });

  it('does not request persistent access to problem sites', () => {
    expect(extensionConfig.manifest).not.toHaveProperty('optional_host_permissions');
  });

  it('strips API credentials from public settings', () => {
    const publicValue = RuntimeResultSchemas['settings:get'].parse({
      hasApiKey: true,
      hasDataUseConsent: true,
      apiKey: 'sk-must-not-cross-the-message-boundary',
      dataUseConsentVersion: 1,
      model: 'gpt-6-astra',
      reasoningEffort: 'high',
      reasoningMode: 'standard',
    });
    expect(publicValue).not.toHaveProperty('apiKey');
    expect(publicValue).not.toHaveProperty('dataUseConsentVersion');
    expect(publicValue).not.toHaveProperty('model');
    expect(publicValue).not.toHaveProperty('reasoningEffort');
    expect(publicValue).not.toHaveProperty('reasoningMode');
  });

  it('strips the private coaching map from side-panel session events', () => {
    const event = CoachServerEventSchema.parse({
      ...sessionReadyFixture,
      messages: [],
      coachingMap: { solution: 'must remain private' },
    });
    expect(event).not.toHaveProperty('coachingMap');
  });

  it('strips the private coaching map from restored conversations', () => {
    const result = RuntimeResultSchemas['session:get-active'].parse({
      session: {
        ...restorableSessionFixture,
        coachingMap: sessionFixture.coachingMap,
      },
    });
    expect(result.session).not.toHaveProperty('coachingMap');
  });
});
