import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('rejects missing, privileged, denied, and malformed pages safely', async () => {
    mocks.query.mockResolvedValueOnce([]);
    await expect(extractActiveProblem()).rejects.toThrow(/No active webpage/);

    // Chrome withholds the URL until the extension may read the tab.
    mocks.query.mockResolvedValueOnce([{ id: 1 }]);
    await expect(extractActiveProblem()).rejects.toThrow(/access was not granted/);
    expect(mocks.executeScript).not.toHaveBeenCalled();

    mocks.query.mockResolvedValueOnce([{ id: 1, url: 'chrome://extensions' }]);
    await expect(extractActiveProblem()).rejects.toThrow(/does not allow/);

    mocks.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com' }]);
    mocks.executeScript.mockRejectedValueOnce(new Error('raw browser error'));
    await expect(extractActiveProblem()).rejects.toThrow(/access was not granted/);

    mocks.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com' }]);
    mocks.executeScript.mockResolvedValueOnce([{ result: { bad: true } }]);
    await expect(extractActiveProblem()).rejects.toThrow(/valid problem statement/);
  });
});
