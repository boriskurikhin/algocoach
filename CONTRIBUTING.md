# Contributing

Read `MANIFESTO.md` and `AGENTS.md` first. Coaching restraint, learner control,
and privacy are acceptance criteria.

## Before opening a change

1. Keep the extension to the side panel and settings surfaces.
2. Add no Chrome permission without documenting why a user-triggered narrower
   permission cannot work.
3. Add runtime validation at any new DOM, message, storage, model, or tool
   boundary.
4. Add a policy scenario when changing prompts or hint progression.
5. Use synthetic statements, keys, code, and learner evidence in tests.

Run:

```sh
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
```

Site-adapter changes should include a sanitized fixture and a negative case.
Learner-profile changes should test contradictory evidence, stale confidence,
disabled personalization, and user correction. Visualization changes must
remain usable with reduced motion and must never execute model-provided markup.
