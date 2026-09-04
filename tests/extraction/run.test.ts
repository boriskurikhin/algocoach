import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_ACCESS_DENIED_MESSAGE } from '../../src/extraction/schema';
import { problemFixture } from '../fixtures/domain';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  executeScript: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    tabs: { query: mocks.query },
    scripting: { executeScript: mocks.executeScript },
  },
}));

import { extractActiveProblem } from '../../src/extraction/run';

describe('active-tab extraction boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a valid extraction from an HTTP tab', async () => {
    mocks.query.mockResolvedValue([{ id: 0, url: problemFixture.source.url }]);
    mocks.executeScript.mockResolvedValue([{ result: problemFixture }]);

    const result = await extractActiveProblem();
    expect(result.likelyProblem).toBe(true);
    expect(result.context).toMatchObject({
      title: problemFixture.title,
      source: problemFixture.source,
    });
    expect(mocks.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 0 } }),
    );
  });

  it('retries while a LeetCode SPA description is still loading', async () => {
    const source = {
      url: 'https://leetcode.com/problems/two-sum/',
      host: 'leetcode.com',
      site: 'leetcode' as const,
      extractedAt: 1,
    };
    const loading = {
      ...problemFixture,
      source,
      statement: 'Loading problem description…',
      confidence: 0.4,
    };
    const loaded = { ...problemFixture, source, title: 'Two Sum', confidence: 0.95 };
    mocks.query.mockResolvedValue([{ id: 2, url: source.url }]);
    mocks.executeScript
      .mockResolvedValueOnce([{ result: loading }])
      .mockResolvedValueOnce([{ result: loaded }]);

    vi.useFakeTimers();
    try {
      const result = extractActiveProblem();
      await vi.advanceTimersByTimeAsync(500);

      await expect(result).resolves.toMatchObject({
        likelyProblem: true,
        context: { title: 'Two Sum' },
      });
      expect(mocks.executeScript).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects missing, privileged, denied, and malformed pages safely', async () => {
    mocks.query.mockResolvedValueOnce([]);
    await expect(extractActiveProblem()).rejects.toThrow(/No active webpage/);

    // Chrome withholds the URL until the extension may read the tab.
    mocks.query.mockResolvedValueOnce([{ id: 1 }]);
    await expect(extractActiveProblem()).rejects.toThrow(PAGE_ACCESS_DENIED_MESSAGE);
    expect(mocks.executeScript).not.toHaveBeenCalled();

    mocks.query.mockResolvedValueOnce([{ id: 1, url: 'chrome://extensions' }]);
    await expect(extractActiveProblem()).rejects.toThrow(/does not allow/);

    mocks.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com' }]);
    mocks.executeScript.mockRejectedValueOnce(new Error('raw browser error'));
    await expect(extractActiveProblem()).rejects.toThrow(PAGE_ACCESS_DENIED_MESSAGE);

    mocks.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com' }]);
    mocks.executeScript.mockResolvedValueOnce([{ result: { bad: true } }]);
    await expect(extractActiveProblem()).rejects.toThrow(/valid problem statement/);
  });
});
