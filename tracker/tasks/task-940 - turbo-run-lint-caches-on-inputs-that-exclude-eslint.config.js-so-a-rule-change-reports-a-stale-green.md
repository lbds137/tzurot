---
id: TASK-940
title: >-
  turbo run lint caches on inputs that exclude eslint.config.js, so a rule
  change reports a stale green
status: To Do
assignee: []
created_date: '2026-09-12 12:38'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 938000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: enabling @typescript-eslint/consistent-type-exports on PR 2402 and re-running pnpm turbo run lint reported 25 of 27 packages green from cache; only --force produced the real violation count (one file). A lint-rule change therefore ships with a false-green local gate, and CI (a cold cache) is the first place the violations appear. Measured cost: one wasted local cycle per rule change, and a rule PR whose local count means nothing.
Fix shape: add eslint.config.js (and the eslint-plugin files under packages/tooling or wherever custom rules live) to the lint task inputs in turbo.json so the hash keys on them; verify with a no-op edit to eslint.config.js followed by pnpm turbo run lint showing 0 cached; note in 05-tooling.md that a rule change invalidates the lint cache by design.
Acceptance: after editing eslint.config.js, pnpm turbo run lint reports 0 cached on the next run without --force; the existing cached behaviour for unrelated edits is unchanged.
<!-- SECTION:DESCRIPTION:END -->
