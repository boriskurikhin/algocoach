import { browser } from 'wxt/browser';

/**
 * Page access is optional and per-site. Nothing is granted at install; the
 * learner allows one problem site at a time and can revoke it in Chrome.
 */
export function siteOriginPattern(url: string): string | null {
  try {
    const { protocol, origin } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? `${origin}/*` : null;
  } catch {
    return null;
  }
}

/** Assumes access when Chrome cannot answer, so the panel never nags blindly. */
export async function hasSiteAccess(pattern: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [pattern] });
  } catch {
    return true;
  }
}

/** Call directly from a click handler; Chrome requires an unspent gesture. */
export const requestSiteAccess = (pattern: string): Promise<boolean> =>
  browser.permissions.request({ origins: [pattern] });
