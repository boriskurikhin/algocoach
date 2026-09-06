# Chrome Web Store submission notes

Use this page when filling out the Developer Dashboard. Keep the answers in
sync with the shipped code and [`PRIVACY.md`](../PRIVACY.md).

## Single purpose

> Socratic Algo Coach reads a competitive-programming problem after the user
> invokes it and provides guided, anti-spoiler coaching beside the page.

## Permission justifications

- **activeTab:** Temporarily reads the current problem page after the user
  clicks the extension.
- **scripting:** Runs the bundled problem extractor in that active tab. It does
  not execute downloaded or model-generated code.
- **sidePanel:** Displays coaching beside the problem.
- **storage:** Stores the user-provided API key, consent choice, temporary
  session state, and optional learner profile.
- **`https://api.openai.com/*`:** Sends user-initiated coaching requests
  directly to OpenAI with the user's API key.

The extension does not use remote code. OpenAI returns text and validated
structured data; it does not provide executable extension code.

## Data-use declarations

Review the Dashboard's current labels and disclose every applicable category,
including:

- authentication information: the user-provided OpenAI API key;
- website content and browsing activity: the active problem page and URL;
- user-generated content or personal communications: chat messages and pasted
  code;
- derived or personalized data: the bounded learner snapshot when
  personalization is enabled.

All data is used only for the extension's coaching purpose. It is not sold,
used for advertising, or read by the developer. OpenAI is the only third-party
processor. Requests use HTTPS, `store: false`, and an implicit prompt-prefix
cache with a 30-minute TTL.

Privacy policy URL:

<https://github.com/boriskurikhin/algocoach/blob/main/PRIVACY.md>

Certify compliance with the Chrome Web Store User Data Policy and Limited Use
requirements.

## Listing disclosure

State prominently that:

- an OpenAI API key with GPT-6 Astra access is required;
- the user pays OpenAI directly;
- starting a problem makes one model request and each normal turn makes two;
- problem text, recent chat, derived coaching context, and an optional learner
  snapshot are sent to OpenAI;
- there is no application backend or analytics; and
- the extension is designed to coach rather than provide complete solutions.

## Reviewer instructions

Provide a dedicated OpenAI project key with GPT-6 Astra and Responses API
access. Apply a low project spending limit and rotate the key after review.
Include these steps:

1. Save the key in **Settings** and accept the data-use disclosure.
2. Open a supported problem page and click the extension icon.
3. Click **Start coaching**.
4. Send a short description of an attempted approach.
5. Confirm that a guarded coaching reply appears in the side panel.

## Required listing material

- 128×128 store icon
- at least one 1280×800 or 640×400 screenshot
- 440×280 small promotional tile
- support contact and privacy-policy URL
- accurate description, category, language, and distribution settings

Before uploading:

```sh
npm run format:check
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run zip
```

Upload only the newly generated ZIP and increment the manifest version for
every subsequent submission.
