import { describe, expect, it } from 'vitest';
import {
  ActiveSessionResultSchema,
  CoachServerEventSchema,
  PublicSettingsSchema,
} from '../../src/messaging/schema';
import {
  extensionHostPermissions,
  extensionOptionalHostPermissions,
  extensionPermissions,
} from '../../wxt.config';
import {
  learnerSnapshotFixture,
  problemFixture,
  sessionFixture,
} from '../fixtures/domain';

describe('extension trust boundaries', () => {
  it('requests temporary page access and only the OpenAI network origin', () => {
    expect(extensionPermissions).toEqual([
      'activeTab',
      'scripting',
      'sidePanel',
      'storage',
    ]);
    expect(extensionHostPermissions).toEqual(['https://api.openai.com/*']);
    expect(JSON.stringify(extensionHostPermissions)).not.toContain('<all_urls>');
  });

  it('keeps problem-site access optional rather than granted at install', () => {
    expect(extensionOptionalHostPermissions).toEqual(['https://*/*', 'http://*/*']);
    for (const pattern of extensionOptionalHostPermissions) {
      expect(extensionHostPermissions).not.toContain(pattern);
    }
  });

  it('strips API credentials from public settings', () => {
    const publicValue = PublicSettingsSchema.parse({
      hasApiKey: true,
      apiKey: 'sk-must-not-cross-the-message-boundary',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      reasoningMode: 'standard',
    });
    expect(publicValue).not.toHaveProperty('apiKey');
    expect(
      PublicSettingsSchema.safeParse({
        ...publicValue,
        model: 'gpt-5.6-terra',
      }).success,
    ).toBe(false);
  });

  it('strips the private coaching map from side-panel session events', () => {
    const event = CoachServerEventSchema.parse({
      type: 'session:ready',
      sessionId: 'session',
      problem: problemFixture,
      stage: 'listen',
      messages: [],
      learnerSnapshot: learnerSnapshotFixture,
      coachingMap: { canonicalFamily: 'must remain private' },
    });
    expect(event).not.toHaveProperty('coachingMap');
  });

  it('strips the private coaching map from restored conversations', () => {
    const result = ActiveSessionResultSchema.parse({
      session: {
        sessionId: sessionFixture.id,
        problem: sessionFixture.problem,
        stage: sessionFixture.stage,
        messages: sessionFixture.messages,
        coachingMap: sessionFixture.coachingMap,
      },
    });
    expect(result.session).not.toHaveProperty('coachingMap');
  });
});
