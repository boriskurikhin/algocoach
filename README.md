# Socratic Algo Coach

A local-first Chrome side-panel extension for competitive-programming practice.
It studies the active problem before the conversation begins, asks what the
learner wants from the session, and adapts without supplying the solution.

Read [`MANIFESTO.md`](MANIFESTO.md) before changing the coaching behavior. The
manifesto is the product contract.

## What it does

- Extracts problem statements from LeetCode, DMOJ, Codeforces, USACO, and
  Advent of Code.
- Shows the official Codeforces rating when available, or a clearly marked
  CF-equivalent estimate after studying the problem.
- Uses a conservative semantic fallback for other problem-setting sites.
- Lets the learner paste a statement when page recognition is uncertain.
- Privately builds a solution-aware coaching map with GPT-5.6 Sol.
- Runs a separate safety and completion gate before any response reaches the
  learner.
- Recognizes when the learner has demonstrated an optimal solution, confirms
  it explicitly, and closes the coaching session to further hints.
- Refuses complete code, answer-shaped pseudocode, passing rewrites, and
  premature algorithm reveals.
- Allows one small teaching snippet for isolated syntax or a learner-owned
  fragment and highlights Python, C, C++, Java, JavaScript, TypeScript, Go,
  Rust, and shell syntax locally.
- Accepts pasted code as conversation text but never reads or edits a site
  editor.
- Draws validated, animated SVG explanations for arrays, matrices, trees, and
  graphs.
- Builds a transparent local learner profile from evidence, confidence, and
  recency.

The interface has exactly two surfaces:

1. a side panel for the current problem and coaching conversation;
2. a settings page for OpenAI, privacy, and learner-memory controls.

## Privacy model

There is no application backend and no analytics.

The user supplies their own OpenAI API key. The key is stored in
`chrome.storage.local`, restricted to trusted extension contexts, and used only
by the Manifest V3 service worker when calling `https://api.openai.com`.
Content scripts and page code never receive it.

Browser-local storage is not a hardware secret store. Someone with access to
the browser profile can recover a persistent key. The settings page states
this directly and provides a remove-key control.

Problem text, recent conversation messages, a private coaching map, and only
the relevant minimum learner-profile snapshot are sent to OpenAI during a
coaching request. Full learner evidence, unrelated estimates, and the API key
never cross into the problem page.

The private coaching map and chat session live in session-scoped extension
storage. The learner profile persists locally and can be inspected, corrected,
pinned, exported, disabled, or erased.

## Coaching behavior

The coach uses a slow ladder:

1. listen to the learner's current model;
2. clarify one statement or representation issue;
3. trace one tiny example;
4. expose one contradiction or broken invariant;
5. name the boundary of the missing idea;
6. connect knowledge the learner has already demonstrated.

The ladder guides each response; it is not exposed or persisted as session
state.

There is no final “give me the answer” rung. A determined user can inspect an
open-source extension, so this is a pedagogical guardrail rather than an
anti-cheating security boundary.

Each normal turn uses two OpenAI responses: a candidate coaching response and
an independent guard/rewrite. Starting a problem uses an additional private
analysis response. This improves restraint but increases API cost and latency.
The user pays OpenAI directly under their own account.

Requests use standard processing instead of the 2×-priced Fast tier. Reasoning
effort and output budgets scale from extracted site difficulty or the private
Codeforces-equivalent estimate. Easy, Bronze, and roughly ≤1200 problems use
GPT-5.6 Luna at low effort; problems through 1900 use Terra; and harder problems
use Sol. Unrated problems start with the conservative Terra/medium analysis
tier, then use that analysis's estimate for coaching. Problems rated 2500+ use
xhigh, and 3000+ problems use max. Stable cache keys improve reuse of repeated
prompt prefixes.

Maximum reasoning/output budgets remain 64k tokens for private analysis, 48k
for a coaching draft, and 24k for the safety pass. Easier tiers receive smaller
caps. Once OpenAI accepts a streamed model step, the extension lets it finish
instead of imposing an additional wall-clock cutoff. The learner can stop it
explicitly or close the panel to abort the request.

## Learner memory

The local profile can estimate:

- preferred and demonstrated languages;
- encountered, practicing, and reliable concepts;
- strengths in modeling, proofs, complexity, debugging, and implementation;
- recurring observable roadblocks;
- coaching styles that have helped.

Every estimate records evidence type, confidence, sample count, and recency.
Repeated demonstrations are required before the profile marks knowledge
reliable. Stale beliefs decay. Current behavior always outranks the profile.

The profile never stores fixed labels for intelligence, personality, morality,
or mental health. It can remember “requested a stronger hint before attempting
the proposed trace”; it cannot decide that a learner is “lazy.”

## Install an unpacked development build

Requirements:

- Node.js 22 or newer;
- Chrome 116 or newer;
- an OpenAI API key with access to GPT-5.6 Luna, Terra, and Sol.

```sh
npm install
npm run build
```

Then:

1. open `chrome://extensions`;
2. enable **Developer mode**;
3. click **Load unpacked**;
4. choose `.output/chrome-mv3`;
5. pin the extension and click its icon on a problem page;
6. open **Settings**, save the API key, and optionally test it.

Opening the side panel performs only local extraction. No paid model request is
made until **Start coaching** is clicked.

## Development

```sh
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

Other commands:

```sh
npm run test:coverage
npx playwright install chromium # once
npm run test:e2e
npm run format
npm run zip
```

No API key is needed for the automated unit suite. Model calls are mocked.

## Architecture

```text
problem page
    │ explicit activeTab extraction
    ▼
typed site adapter ──► side panel
                         │ validated extension messages
                         ▼
                 Manifest V3 service worker
                    │                 │
                    │                 ├── local learner profile
                    │                 └── session-only coaching map
                    ▼
               OpenAI Responses API
                    │
             independent guard
                    │
                    ├── concise coach reply
                    └── validated SVG scene
```

Important locations:

- `entrypoints/background.ts` — trusted message, storage, and model boundary;
- `entrypoints/sidepanel/` — problem and conversation interface;
- `entrypoints/options/` — key, privacy, and profile controls;
- `src/extraction/` — adapters and generic recognition;
- `src/agent/` — private analysis, response drafting, and guard;
- `src/prompts/` — coaching contracts and trust delimiters;
- `src/learner/` — evidence-weighted profile reducer;
- `src/visualization/` — declarative tool schema and SVG renderer.

## Chrome permissions

- `activeTab` — temporary access after the user invokes the extension;
- `scripting` — run the selected extractor in that active tab;
- `sidePanel` — keep coaching beside the problem;
- `storage` — settings, session state, and learner memory;
- `https://api.openai.com/*` — the only persistent network host permission.

The extension intentionally does not request `<all_urls>`, debugger access,
clipboard access, site-editor access, or background page surveillance.

## Site support and limitations

Site adapters use stable semantic selectors where available, but competitive-
programming sites can change markup without notice. Low-confidence extraction
is shown to the learner instead of silently pretending to be correct.

LeetCode extraction reads embedded question data when available, falls back to
the hydrated description, and briefly retries while the SPA is loading.
Account- or Premium-locked statements still require access or a manual paste.

The generic extractor works best when a page has:

- a primary `main` or `article` region;
- a clear heading;
- explicit input/output headings;
- preformatted sample data.

Statements inside inaccessible iframes, image-only PDFs, authentication walls,
or Chrome-restricted pages must be pasted manually. The extension does not
submit solutions or verify online-judge results.

## Safety boundaries

- DOM text and pasted code are treated as untrusted prompt input.
- Hidden and irrelevant page regions are removed where possible.
- All extracted data is length-capped and runtime-validated.
- Model output is buffered until the pedagogy gate approves it.
- Visualization tools accept only strict declarative primitives.
- React renders model-generated labels as text; arbitrary HTML and JavaScript are not
  accepted.
- The public settings message contains only `hasApiKey`, never the key.
- Private coaching maps are excluded from side-panel events.

Please report security problems according to [`SECURITY.md`](SECURITY.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Changes that weaken learner ownership,
privacy, runtime validation, or minimal permissions will not be accepted even
if they make the extension feel more immediately helpful.

## License

MIT
