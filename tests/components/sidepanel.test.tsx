import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  problemFixture,
  restorableSessionFixture,
  sceneFixture,
  sessionFixture,
  sessionReadyFixture,
} from '../fixtures/domain';
import { publicSettingsFixture } from '../fixtures/openai';

const mocks = vi.hoisted(() => {
  const messageListeners = new Set<(message: unknown) => void>();
  const disconnectListeners = new Set<() => void>();
  const postMessage = vi.fn();
  const disconnect = vi.fn();
  const port = {
    postMessage,
    disconnect,
    onMessage: {
      addListener: (listener: (message: unknown) => void) =>
        messageListeners.add(listener),
      removeListener: (listener: (message: unknown) => void) =>
        messageListeners.delete(listener),
    },
    onDisconnect: {
      addListener: (listener: () => void) => disconnectListeners.add(listener),
      removeListener: (listener: () => void) => disconnectListeners.delete(listener),
    },
  };
  const connect = vi.fn(() => port);
  return {
    sendMessage: vi.fn(),
    postMessage,
    connect,
    openOptionsPage: vi.fn(),
    contains: vi.fn(),
    request: vi.fn(),
    createTab: vi.fn(),
    messageListeners,
    disconnectListeners,
  };
});

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: mocks.sendMessage,
      connect: mocks.connect,
      openOptionsPage: mocks.openOptionsPage,
    },
    permissions: { contains: mocks.contains, request: mocks.request },
    tabs: { create: mocks.createTab },
  },
}));

import App from '../../entrypoints/sidepanel/App';

function emit(message: unknown) {
  for (const listener of mocks.messageListeners) listener(message);
}

function disconnectPort() {
  for (const listener of [...mocks.disconnectListeners]) listener();
}

async function runtimeResponse(request: { type: string }) {
  if (request.type === 'settings:get') {
    return { ok: true, data: { ...publicSettingsFixture, hasApiKey: true } };
  }
  if (request.type === 'problem:extract') {
    return {
      ok: true,
      data: { context: problemFixture, likelyProblem: true },
    };
  }
  if (request.type === 'session:get-active') {
    return { ok: true, data: { session: null } };
  }
  if (request.type === 'session:clear-active') {
    return { ok: true, data: {} };
  }
  return { ok: false, error: 'Unexpected request.' };
}

async function runtimeResponseWithSession(request: { type: string }) {
  if (request.type === 'session:get-active') {
    return { ok: true, data: { session: restorableSessionFixture } };
  }
  return runtimeResponse(request);
}

describe('side panel coaching flow', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.sendMessage.mockReset();
    mocks.postMessage.mockClear();
    mocks.connect.mockClear();
    mocks.openOptionsPage.mockClear();
    mocks.messageListeners.clear();
    mocks.disconnectListeners.clear();
    mocks.contains.mockResolvedValue(true);
    mocks.request.mockResolvedValue(true);
    mocks.sendMessage.mockImplementation(runtimeResponse);
  });

  it('moves from local extraction through a guarded response', async () => {
    render(<App />);

    expect(await screen.findByText('Batch Sums')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start coaching' }));
    expect(mocks.postMessage).toHaveBeenCalledWith({
      type: 'session:start',
      problem: problemFixture,
    });

    act(() => {
      emit({
        ...sessionReadyFixture,
        messages: [
          {
            id: 'opening',
            role: 'assistant',
            content: 'What are you thinking so far?',
            createdAt: 1,
          },
        ],
      });
    });
    expect(screen.getByText('What are you thinking so far?')).toBeInTheDocument();
    expect(screen.getByText(/1\.5K tokens · ≈\$0\.013/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('What are you thinking?'), {
      target: { value: 'I think rounding is involved, but I lose extra units.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask the coach' }));
    expect(screen.getByText(/I think rounding is involved/)).toBeInTheDocument();
    expect(mocks.postMessage).toHaveBeenLastCalledWith({
      type: 'session:user-message',
      sessionId: 'session-1',
      content: 'I think rounding is involved, but I lose extra units.',
    });

    act(() => {
      emit({
        type: 'coach:chunk',
        sessionId: 'session-1',
        chunk: 'Where does the sixth unit go?',
      });
    });
    expect(screen.getByText('Where does the sixth unit go?')).toBeInTheDocument();

    act(() => {
      emit({
        type: 'coach:reply',
        sessionId: 'session-1',
        stage: 'clarify',
        usage: sessionFixture.usage,
        message: {
          id: 'reply',
          role: 'assistant',
          content:
            'Where does the sixth unit go?\n```python\nused = min(needed, saved)\n```',
          createdAt: 2,
          visualization: sceneFixture,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Hint stage: clarify')).toBeInTheDocument();
    });
    expect(screen.getByText('python')).toBeInTheDocument();
    expect(document.querySelector('.token.builtin')).toHaveTextContent('min');
    expect(screen.getByText('One batch')).toBeInTheDocument();
    expect(screen.getByText(sceneFixture.question)).toBeInTheDocument();
  });

  it('restores the active conversation when the panel is reopened', async () => {
    mocks.sendMessage.mockImplementation(runtimeResponseWithSession);

    render(<App />);

    expect(
      await screen.findByText('What are you thinking so far?'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('I think I need to round up each batch.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Hint stage: listen')).toBeInTheDocument();
    expect(mocks.sendMessage).not.toHaveBeenCalledWith({ type: 'problem:extract' });

    fireEvent.click(screen.getByRole('button', { name: 'Change problem' }));
    await waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalledWith({
        type: 'session:clear-active',
        sessionId: sessionFixture.id,
      });
    });
    expect(screen.getByRole('button', { name: 'Start coaching' })).toBeInTheDocument();
  });

  it('keeps the conversation open when changing problems cannot be saved', async () => {
    mocks.sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'session:clear-active') {
        return { ok: false, error: 'Session storage is unavailable.' };
      }
      return runtimeResponseWithSession(request);
    });

    render(<App />);
    expect(
      await screen.findByText('I think I need to round up each batch.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change problem' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Session storage is unavailable.',
    );
    expect(screen.getByText('Hint stage: listen')).toBeInTheDocument();
  });

  it('reconnects before the next coaching message after an idle disconnect', async () => {
    render(<App />);
    expect(await screen.findByText('Batch Sums')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start coaching' }));
    act(() => {
      emit(sessionReadyFixture);
    });

    act(disconnectPort);
    fireEvent.change(screen.getByLabelText('What are you thinking?'), {
      target: { value: 'I traced one more batch.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask the coach' }));

    expect(mocks.connect).toHaveBeenCalledTimes(2);
    expect(mocks.postMessage).toHaveBeenLastCalledWith({
      type: 'session:user-message',
      sessionId: sessionFixture.id,
      content: 'I traced one more batch.',
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows timed model progress and the reason a request stopped', async () => {
    const view = render(<App />);

    expect(await screen.findByText('Batch Sums')).toBeInTheDocument();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Start coaching' }));
      expect(
        screen.getByText('Reading the statement and constraints…'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/OpenAI.*Standard.*high reasoning.*10m limit/),
      ).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(4_000));
      expect(
        screen.getByText('Separating the core model from edge cases…'),
      ).toBeInTheDocument();

      act(() => {
        emit({
          type: 'coach:error',
          message:
            'OpenAI reached this step’s reasoning/output budget before finishing. Try again.',
        });
      });

      expect(screen.getByRole('alert')).toHaveTextContent('reasoning/output budget');
      expect(screen.queryByText(/10m limit/)).not.toBeInTheDocument();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('keeps the worker session alive while a model request is pending', async () => {
    const view = render(<App />);
    expect(await screen.findByText('Batch Sums')).toBeInTheDocument();

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Start coaching' }));
      act(() => vi.advanceTimersByTime(15_000));
      expect(mocks.postMessage).toHaveBeenCalledWith({ type: 'coach:keepalive' });
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('offers a lasting grant for one site only while access is temporary', async () => {
    mocks.contains.mockResolvedValue(false);
    render(<App />);

    const grant = await screen.findByRole('button', {
      name: /read judge\.example without the icon/i,
    });
    fireEvent.click(grant);

    expect(mocks.request).toHaveBeenCalledWith({
      origins: ['https://judge.example/*'],
    });
    await waitFor(() => {
      expect(grant).not.toBeInTheDocument();
    });
  });

  it('does not ask again once the site is permanently allowed', async () => {
    render(<App />);

    expect(await screen.findByText('Batch Sums')).toBeInTheDocument();
    expect(screen.queryByText(/without the icon/i)).not.toBeInTheDocument();
  });

  it('routes a denied page to Chrome’s own site-access control', async () => {
    mocks.sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'problem:extract') {
        return { ok: false, error: 'Page access was not granted. Click the icon.' };
      }
      return runtimeResponse(request);
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open site access settings' }),
    );
    expect(mocks.createTab).toHaveBeenCalledWith({
      url: expect.stringContaining('chrome://extensions/?id='),
    });
  });
});
