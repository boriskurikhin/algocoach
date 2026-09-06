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
      screen.queryByText(/\b(?:OpenAI|GPT|Luna|Terra|Sol|Astra|reasoning ceiling)\b/i),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('API key'), {
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
});
