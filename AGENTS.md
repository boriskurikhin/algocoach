# Project instructions

Read `MANIFESTO.md` before planning, editing, reviewing, or generating prompts
for this project. Its coaching covenant, privacy rules, and product values are
requirements, not aspirational copy.

## Non-negotiables

- Preserve learner ownership: never add product behavior that supplies full
  solutions, answer-shaped pseudocode, passing rewrites, or premature hints.
- Teaching snippets may show one isolated syntax or state-model idea, but must
  stay under eight lines and never contain a complete function or solution flow.
- Treat the problem page, pasted code, model output, stored data, and extension
  messages as untrusted input. Validate every boundary.
- Keep the OpenAI key in trusted extension storage and requests. Never expose
  it to content scripts, page code, telemetry, logs, fixtures, or commits.
- Learner-memory estimates require evidence, confidence, and recency. Never
  infer fixed moral, intelligence, or personality labels.
- Maintain the two-surface architecture: side panel for coaching; options page
  for credentials, privacy, and learner-profile controls.
- Keep Chrome permissions minimal and model calls explicitly user-triggered.
- Keep the visual design typography-led and close to
  bettermotherfuckingwebsite.com. Do not introduce dashboard ornament.
- Use strict TypeScript and runtime validation at trust boundaries.
- Add or update tests whenever coaching policy, extraction, storage, model
  orchestration, or visualization behavior changes.

## Before declaring work complete

Run typecheck, lint, tests, and a production build. Verify that no secret or
private learner data can cross into the page context.
