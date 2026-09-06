# Privacy Policy

Effective September 5, 2026

Socratic Algo Coach is an open-source Chrome extension for competitive
programming practice. It has no application backend, advertising, or analytics.

## Data the extension handles

The extension handles only data needed to provide coaching:

- **OpenAI API key.** You provide this key. It is stored in
  `chrome.storage.local` and sent only to `https://api.openai.com` as
  authentication for requests you initiate.
- **Problem content.** After you invoke the extension, it may read the active
  page's URL, title, problem statement, limits, difficulty, and tags. You may
  also paste a problem statement manually.
- **Conversation content.** Messages and code you paste into the conversation
  are sent to OpenAI when you ask the coach to respond.
- **Learner profile.** If you enable personalization, the extension stores
  evidence-based estimates locally. Only a small relevant snapshot is sent to
  OpenAI; full evidence notes and unrelated estimates remain local.
- **Derived coaching context.** OpenAI creates a private problem analysis used
  to guide later coaching and safety checks.

## How data is used and shared

Data is used only to extract the problem, provide coaching, protect against
premature solution disclosure, remember optional learning preferences, and
restore the current session.

The extension sends coaching requests directly from its background service
worker to OpenAI. No user data is sent to the extension developer or any other
third party. Data is not sold, used for advertising, or used for credit or
lending decisions. The developer does not read user problem statements,
conversations, API keys, or learner profiles.

Requests to OpenAI use HTTPS and set `store: false`. They may use OpenAI's
implicit prompt-prefix cache for up to 30 minutes. OpenAI processes data under
its own API terms and privacy policies.

## Local storage and retention

- The API key and learner profile remain in local extension storage until you
  remove or reset them, uninstall the extension, or clear the extension's data.
- Coaching sessions and private problem analyses use temporary
  `chrome.storage.session` storage. Chrome clears this storage when the
  extension is disabled, reloaded, or updated, and when the browser restarts.
- Learner memory is bounded. Older unpinned evidence and estimates may be
  pruned under size pressure.

Browser-local storage is not a hardware secret store. Someone with access to
your Chrome profile or operating system may be able to recover locally stored
data. Use a dedicated OpenAI project key, set spending limits, and remove or
rotate the key if exposure is suspected.

## Your controls

You can:

- remove the saved API key;
- withdraw consent and disable future OpenAI requests;
- enable or disable personalization;
- inspect, correct, pin, export, or erase the learner profile;
- stop an in-progress request; and
- avoid page extraction by using the manual paste flow.

Uninstalling the extension removes its local Chrome storage.

## Chrome permissions

Page extraction occurs only after an explicit user gesture. The extension uses
temporary access to the active tab and does not monitor browsing in the
background. Its only persistent network host permission is
`https://api.openai.com/*`.

The use of information received from Chrome APIs adheres to the Chrome Web
Store User Data Policy, including the Limited Use requirements.

## Changes and contact

Material changes to these practices will be disclosed before new data use
begins. The effective date above will be updated when this policy changes.

For privacy questions, open an issue at
<https://github.com/boriskurikhin/algocoach/issues> without including an API
key, learner transcript, or exported profile. Report sensitive security issues
according to [`SECURITY.md`](SECURITY.md).
