import { browser } from 'wxt/browser';
import { adapterForUrl, isLikelyProblem } from './recognize';
import { extractProblemFromDocument } from './extract-in-page';
import {
  PAGE_ACCESS_DENIED_MESSAGE,
  ProblemContextSchema,
  type ActiveProblemResult,
  type ProblemContext,
} from './schema';

const LEETCODE_RETRY_DELAYS_MS = [0, 500, 1_000] as const;

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
    throw new Error(PAGE_ACCESS_DENIED_MESSAGE);
  }
  if (!/^https?:/.test(tab.url)) {
    throw new Error('Chrome does not allow problem extraction on this page.');
  }

  const config = adapterForUrl(tab.url);
  const delays = config.site === 'leetcode' ? LEETCODE_RETRY_DELAYS_MS : [0];
  let bestContext: ProblemContext | null = null;
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    let results;
    try {
      results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractProblemFromDocument,
        args: [config],
      });
    } catch {
      throw new Error(PAGE_ACCESS_DENIED_MESSAGE);
    }

    const parsed = ProblemContextSchema.safeParse(results[0]?.result);
    if (!parsed.success) continue;
    if (
      !bestContext ||
      parsed.data.confidence > bestContext.confidence ||
      parsed.data.statement.length > bestContext.statement.length
    ) {
      bestContext = parsed.data;
    }
    if (isLikelyProblem(parsed.data)) break;
  }

  if (!bestContext) {
    throw new Error('The page did not yield a valid problem statement.');
  }
  return {
    context: bestContext,
    likelyProblem: isLikelyProblem(bestContext),
  };
}
