# Socratic Algo Coach

<p align="center">
  <img src="public/mascot/greeting.png" alt="The Algo Coach mascot waving" width="220">
</p>

A Chrome side-panel coach for competitive programming. It reads the problem
beside you, listens to your approach, and helps you reason toward a solution
without jumping straight to the answer.

It is open source and uses your own OpenAI API key.

## What it does

- Reads problems from LeetCode, DMOJ, Codeforces, USACO, Advent of Code, and
  many ordinary problem pages.
- Accepts a pasted statement when page extraction is unavailable.
- Uses focused questions, small examples, corrections, and optional diagrams.
- Runs every reply through a separate guard before showing it.
- Offers an opt-in, evidence-based learner profile that you can inspect, correct,
  export, or erase.
- Never reads or edits the code editor and never submits a solution.

The coaching principles live in [`MANIFESTO.md`](MANIFESTO.md). That document is
the product contract.

## Try it locally

You need Node.js 22+, Chrome 116+, and an OpenAI API key with GPT-6 Astra access.

```sh
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load
unpacked**, and select `dist/chrome-mv3`. Pin the extension, open a problem page,
click the icon, and add your API key in **Settings**.

Reading the page is local. The first paid request happens when you click
**Start coaching**, after accepting the data-use disclosure.

## Contributing

Contributions are welcome. Before changing coaching behavior, read
[`MANIFESTO.md`](MANIFESTO.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).

Start the development build with:

```sh
npm install
npm run dev
```

Before opening a pull request, run:

```sh
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
```

No API key is needed for the automated tests; model calls are mocked. Packaged
browser coverage is available with:

```sh
npx playwright install chromium # once
npm run test:e2e
```

Good places to contribute include site adapters, extraction fixtures,
accessibility, visual explanations, tests, and documentation. Prompt or learner
profile changes need focused policy tests; site-adapter changes need a sanitized
fixture and a negative case.

## Project map

- `entrypoints/sidepanel/` — problem extraction and coaching UI
- `entrypoints/options/` — API key, privacy, and learner-memory controls
- `entrypoints/background.ts` — trusted storage, messaging, and model boundary
- `src/extraction/` — site adapters and generic page recognition
- `src/agent/` and `src/prompts/` — analysis, coaching, and response guard
- `src/learner/` — local evidence-weighted learner profile
- `src/visualization/` — validated diagrams and SVG rendering
- `tests/` — unit, policy, security, component, and packaged browser tests

The short version:

```text
problem page → extractor → side panel → background worker → OpenAI
                                                        ↓
                                                  response guard
                                                        ↓
                                                    coach reply
```

## Privacy

There is no application backend and no analytics.

The API key and learner profile are stored in trusted extension-local storage.
Browser storage is not a hardware secret store: someone with access to the
browser profile may be able to recover the key.

When coaching starts, the relevant problem text and, if enabled, a small learner
snapshot are sent to OpenAI. During a conversation, recent messages and private
coaching context are sent as well. Sessions use temporary browser storage;
learner memory stays local until you erase it. The user pays OpenAI directly.
Starting a problem uses one model call, and each normal turn uses two.

Page access is temporary and starts with a user gesture; the extension requests
no persistent access to problem sites. Page code never receives the API key,
learner profile, or private coaching map.

Read the full [`PRIVACY.md`](PRIVACY.md), or see [`SECURITY.md`](SECURITY.md) for
the threat model and reporting guidance.

## Limits

Extraction can fail on inaccessible iframes, image-only PDFs, authentication
walls, Premium-only statements, and Chrome-restricted pages. Paste the statement
when that happens.

The anti-spoiler behavior is a pedagogical guardrail, not a security boundary.
A determined user can inspect or modify an open-source extension.

## License

MIT
