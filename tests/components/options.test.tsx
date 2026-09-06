import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyLearnerProfile } from '../../src/learner/update-profile';
import { publicSettingsFixture as publicSettings } from '../fixtures/openai';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: mocks.sendMessage,
    },
  },
}));

import App from '../../entrypoints/options/App';

describe('settings page', () => {
  beforeEach(() => {
    mocks.sendMessage.mockReset();
    mocks.sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'settings:get') {
        return { ok: true, data: publicSettings };
      }
      if (request.type === 'profile:get') {
        return {
          ok: true,
          data: { profile: createEmptyLearnerProfile(1) },
        };
      }
      if (request.type === 'settings:save') {
        return {
          ok: true,
          data: { ...publicSettings, hasApiKey: true },
        };
      }
      if (request.type === 'settings:accept-data-use') {
        return {
          ok: true,
          data: { ...publicSettings, hasDataUseConsent: true },
        };
      }
      if (request.type === 'settings:revoke-data-use') {
        return {
          ok: true,
          data: { ...publicSettings, hasDataUseConsent: false },
        };
      }
      if (request.type === 'settings:test-key') {
        return { ok: true, data: { connected: true } };
      }
      return { ok: false, error: 'Unexpected request.' };
    });
  });

  it('keeps connection setup simple and tests a newly saved key', async () => {
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Connection' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/stored in this browser profile/i)).toBeInTheDocument();
    expect(screen.getByText(/does not assign intelligence/i)).toBeInTheDocument();
    expect(
      screen.getByText(/problem analysis.*directly to OpenAI/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute(
      'href',
      expect.stringContaining('PRIVACY.md'),
    );

    fireEvent.change(screen.getByLabelText('OpenAI API key'), {
      target: { value: 'sk-user-owned' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));

    await waitFor(() => {
      expect(screen.getByText(/The key works/i)).toBeInTheDocument();
    });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'settings:save',
        settings: expect.objectContaining({ apiKey: 'sk-user-owned' }),
      }),
    );
    expect(mocks.sendMessage).toHaveBeenCalledWith({ type: 'settings:test-key' });
  });

  it('requires data-use consent before testing a key', async () => {
    mocks.sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'settings:get') {
        return {
          ok: true,
          data: { ...publicSettings, hasDataUseConsent: false },
        };
      }
      if (request.type === 'profile:get') {
        return {
          ok: true,
          data: { profile: createEmptyLearnerProfile(1) },
        };
      }
      if (request.type === 'settings:accept-data-use') {
        return {
          ok: true,
          data: { ...publicSettings, hasDataUseConsent: true },
        };
      }
      return { ok: false, error: 'Unexpected request.' };
    });
    render(<App />);

    const testButton = await screen.findByRole('button', {
      name: 'Save and test',
    });
    expect(testButton).toBeDisabled();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'I understand—allow OpenAI requests',
      }),
    );
    await waitFor(() => expect(testButton).toBeEnabled());
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: 'settings:accept-data-use',
    });
  });

  it('lets the learner disable future OpenAI requests', async () => {
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Disable OpenAI requests',
      }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: 'I understand—allow OpenAI requests',
        }),
      ).toBeInTheDocument();
    });
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: 'settings:revoke-data-use',
    });
  });
});
