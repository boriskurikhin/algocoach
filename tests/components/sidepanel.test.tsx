import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_ACCESS_DENIED_MESSAGE } from '../../src/extraction/schema';
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

const scrollIntoView = vi.fn();
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView',
);

afterAll(() => {
  if (originalScrollIntoView) {
    Object.defineProperty(
      HTMLElement.prototype,
      'scrollIntoView',
      originalScrollIntoView,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

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
    return { ok: true, data: null };
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
    mocks.openOptionsPage.mockReset();
    mocks.openOptionsPage.mockResolvedValue(undefined);
    mocks.createTab.mockReset();
    mocks.createTab.mockResolvedValue(undefined);
    mocks.messageListeners.clear();
    mocks.disconnectListeners.clear();
    mocks.contains.mockResolvedValue(true);
    mocks.request.mockResolvedValue(true);
    mocks.sendMessage.mockImplementation(runtimeResponse);
    scrollIntoView.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
  });

  it('moves from local extraction through a guarded response', async () => {
    render(<App />);

    expect(await screen.findByText('Batch Sums')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Coach welcomes you' })).toHaveAttribute(
      'data-mascot-state',
      'greeting',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start coaching' }));
    expect(
      screen.getByRole('img', { name: 'Coach is reading your reasoning' }),
    ).toHaveAttribute('data-mascot-state', 'reading');
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
    expect(screen.getByText('CF ≈1300')).toHaveClass('cf-rating-pupil');
    expect(screen.getByText('CF ≈1300')).toHaveAttribute(
      'title',
      'Estimated Codeforces-equivalent rating · Pupil',
    );
    expect(screen.getByRole('img', { name: 'Coach welcomes you' })).toHaveAttribute(
      'data-mascot-state',
      'greeting',
    );

    fireEvent.change(screen.getByLabelText('What would you like to work on?'), {
      target: { value: 'I think rounding is involved, but I lose extra units.' },
    });
    expect(
      screen.getByRole('img', { name: 'Coach is listening while you type' }),
    ).toHaveAttribute('data-mascot-state', 'typing');
    fireEvent.click(screen.getByRole('button', { name: 'Ask the coach' }));
    expect(
      screen.getByRole('img', { name: 'Coach is reading your reasoning' }),
    ).toHaveAttribute('data-mascot-state', 'reading');
    expect(screen.getByText(/I think rounding is involved/)).toBeInTheDocument();
    expect(
      screen.queryByLabelText('What would you like to work on?'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Thinking through what would help next…'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/\b(?:OpenAI|GPT|Luna|Terra|Sol|tokens)\b/i),
    ).not.toBeInTheDocument();
    expect(mocks.postMessage).toHaveBeenLastCalledWith({
      type: 'session:user-message',
      sessionId: 'session-1',
      content: 'I think rounding is involved, but I lose extra units.',
    });

    act(() => {
      emit({
        type: 'coach:reply',
        sessionId: 'session-1',
        completed: false,
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
      expect(screen.getByText('Where does the sixth unit go?')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('img', { name: 'Coach is ready for your next thought' }),
    ).toHaveAttribute('data-mascot-state', 'idle');
    expect(screen.getByText('python')).toBeInTheDocument();
    expect(document.querySelector('.token.builtin')).toHaveTextContent('min');
    expect(screen.getByText('One batch')).toBeInTheDocument();
    expect(screen.getByText(sceneFixture.question)).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    expect(
      screen.getByLabelText('What would you like to work on?'),
    ).toBeInTheDocument();
  });

  it('closes the composer after the learner reaches an optimal solution', async () => {
    mocks.sendMessage.mockImplementation(runtimeResponseWithSession);
    render(<App />);

    expect(
      await screen.findByText('I think I need to round up each batch.'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('What would you like to work on?'), {
      target: {
        value:
          'I preserve every surplus unit and process each conversion once, so it is linear.',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask the coach' }));

    act(() => {
      emit({
        type: 'coach:reply',
        sessionId: sessionFixture.id,
        completed: true,
        message: {
          id: 'completed',
          role: 'assistant',
          content:
            'Yes — you’ve arrived at an optimal solution. This coaching session is complete.',
          createdAt: 3,
        },
      });
    });

    expect(screen.getByText(/^Solved/)).toBeInTheDocument();
    expect(screen.getByText(/arrived at an optimal solution/i)).toBeInTheDocument();
    expect(screen.getByText('Optimal solution reached.')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Coaching session is complete' }),
    ).toHaveAttribute('data-mascot-state', 'complete');
    expect(
      screen.queryByLabelText('What would you like to work on?'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Ask the coach' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose another problem' }),
    ).toBeVisible();
  });

  it('colors an official rating using its Codeforces rank', async () => {
    const grandmasterProblem = {
      ...problemFixture,
      source: {
        ...problemFixture.source,
        site: 'codeforces' as const,
      },
      rating: '*2400',
      codeforcesRating: {
        value: 2_400,
        source: 'official' as const,
      },
    };
    mocks.sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'problem:extract') {
        return {
          ok: true,
          data: { context: grandmasterProblem, likelyProblem: true },
        };
      }
      return runtimeResponse(request);
    });

    render(<App />);

    const rating = await screen.findByText('CF 2400');
    expect(rating).toHaveClass('cf-rating-grandmaster');
    expect(rating).toHaveAttribute('title', 'Official Codeforces rating · Grandmaster');
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
    expect(screen.getByText('CF ≈1300')).toBeInTheDocument();
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

  it('surfaces an active-session restoration failure without re-extracting', async () => {
    mocks.sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'session:get-active') {
        return { ok: false, error: 'Session storage is unavailable.' };
      }
      return runtimeResponse(request);
    });

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Session storage is unavailable.',
    );
    expect(mocks.sendMessage).not.toHaveBeenCalledWith({ type: 'problem:extract' });
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
    expect(
      screen.getByText('I think I need to round up each batch.'),
    ).toBeInTheDocument();
  });

  it('reconnects before the next coaching message after an idle disconnect', async () => {
    render(<App />);
    expect(await screen.findByText('Batch Sums')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start coaching' }));
    act(() => {
      emit(sessionReadyFixture);
    });

    act(disconnectPort);
    fireEvent.change(screen.getByLabelText('What would you like to work on?'), {
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

  it('shows coaching progress and the reason a request stopped', async () => {
    const view = render(<App />);

    expect(await screen.findByText('Batch Sums')).toBeInTheDocument();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Start coaching' }));
      expect(screen.getByText('Reading the statement…')).toBeInTheDocument();
      expect(screen.queryByText(/\b(?:OpenAI|GPT|Luna|Terra|Sol)\b/i)).toBeNull();
      expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(4_000));
      expect(
        screen.getByText('Checking constraints and edge cases…'),
      ).toBeInTheDocument();

      act(() => {
        emit({
          type: 'coach:error',
          message: 'The coach could not finish this step. Try again.',
        });
      });

      expect(screen.getByRole('alert')).toHaveTextContent(
        'The coach could not finish this step.',
      );
      expect(
        screen.getByRole('img', {
          name: 'Coach is here to help you get unstuck',
        }),
      ).toHaveAttribute('data-mascot-state', 'support');
      expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('lets the learner stop a long-running model stream', async () => {
    render(<App />);
    expect(await screen.findByText('Batch Sums')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start coaching' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(mocks.postMessage).toHaveBeenLastCalledWith({ type: 'coach:cancel' });

    act(() => {
      emit({ type: 'coach:canceled' });
    });
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

  it('reports a failed lasting-access request', async () => {
    mocks.contains.mockResolvedValue(false);
    mocks.request.mockRejectedValueOnce(new Error('Permission request failed.'));
    render(<App />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: /read judge\.example without the icon/i,
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Permission request failed.',
    );
  });

  it('does not ask again once the site is permanently allowed', async () => {
    render(<App />);

    expect(await screen.findByText('Batch Sums')).toBeInTheDocument();
    expect(screen.queryByText(/without the icon/i)).not.toBeInTheDocument();
  });

  it('routes a denied page to Chrome’s own site-access control', async () => {
    mocks.sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'problem:extract') {
        return { ok: false, error: PAGE_ACCESS_DENIED_MESSAGE };
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
