import { browser } from 'wxt/browser';
import { adapterForUrl, isLikelyProblem } from './recognize';
import { extractProblemFromDocument } from './extract-in-page';
import { ProblemContextSchema, type ProblemContext } from './schema';

export interface ActiveProblemResult {
  context: ProblemContext;
  likelyProblem: boolean;
}

export async function extractActiveProblem(): Promise<ActiveProblemResult> {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (tab?.id == null) {
    throw new Error('No active webpage is available.');
  }
  // Chrome hides the URL until the extension may read the tab, so an absent
  // URL means access, not a missing page.
  if (!tab.url) {
    throw new Error(
      'Page access was not granted. Click the extension icon on this tab and try again.',
    );
  }
  if (!/^https?:/.test(tab.url)) {
    throw new Error('Chrome does not allow problem extraction on this page.');
  }

  const config = adapterForUrl(tab.url);
  let results;
  try {
    results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractProblemFromDocument,
      args: [config],
    });
  } catch {
    throw new Error(
      'Page access was not granted. Click the extension icon on this tab and try again.',
    );
  }

  const parsed = ProblemContextSchema.safeParse(results[0]?.result);
  if (!parsed.success) {
    throw new Error('The page did not yield a valid problem statement.');
  }
  return {
    context: parsed.data,
    likelyProblem: isLikelyProblem(parsed.data),
  };
}
