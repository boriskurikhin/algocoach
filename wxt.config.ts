import type { Plugin } from 'vite';
import { defineConfig } from 'wxt';

/**
 * KaTeX declares woff2, woff, and ttf for every face. Chrome only ever loads
 * the woff2, so dropping the other two keeps roughly 700kB of dead fonts out
 * of the package. If KaTeX changes this syntax the fonts simply all ship again.
 */
function katexWoff2Only(): Plugin {
  return {
    name: 'katex-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.css') || !id.includes('katex')) return null;
      return code.replace(
        /,url\([^)]+\.woff\) format\("woff"\),url\([^)]+\.ttf\) format\("truetype"\)/g,
        '',
      );
    },
  };
}

export const extensionPermissions = [
  'activeTab',
  'scripting',
  'sidePanel',
  'storage',
] as const;

export const extensionHostPermissions = ['https://api.openai.com/*'] as const;

/**
 * Never granted at install. The learner grants one problem site at a time from
 * the side panel, and can revoke it from Chrome's extension settings.
 */
export const extensionOptionalHostPermissions = ['https://*/*', 'http://*/*'] as const;

const extensionIcons = {
  16: 'mascot/icon-16.png',
  32: 'mascot/icon-32.png',
  48: 'mascot/icon-48.png',
  128: 'mascot/icon-128.png',
};

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [katexWoff2Only()] }),
  manifest: {
    name: 'Socratic Algo Coach',
    short_name: 'Algo Coach',
    description:
      'A patient competitive-programming coach that protects productive struggle.',
    minimum_chrome_version: '116',
    permissions: [...extensionPermissions],
    host_permissions: [...extensionHostPermissions],
    optional_host_permissions: [...extensionOptionalHostPermissions],
    icons: extensionIcons,
    action: {
      default_title: 'Open Socratic Algo Coach',
      default_icon: extensionIcons,
    },
  },
});
