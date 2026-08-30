---
id: TASK-829
title: >-
  pnpm test OOMs ai-worker on Steam Deck: LOW_RESOURCE_MODE does not reach turbo
  concurrency
status: To Do
assignee: []
created_date: '2026-08-30 03:01'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 829000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: observed 4 times in one session (2026-08-29). Bare `pnpm test` fails with `Failed: @tzurot/ai-worker#test` while `pnpm --filter ai-worker test` passes 232 files / 5430 tests immediately after. It failed even on changes that CANNOT affect ai-worker: a test-only edit in common-types, and a comment-only edit in constants/ai.ts. Every time, a plain retry went 26/26 green, so it is resource contention, not a real failure.

Mechanism, verified: LOW_RESOURCE_MODE=1 is read ONLY by vitest.config.ts:20 (maxWorkers 1 instead of 3), which throttles workers WITHIN a single package run. It does not touch turbos cross-package concurrency, so `pnpm test` still starts several package vitest instances at once and the Steam Deck OOM-kills one. The proof is that .husky/pre-push:110 already sets TURBO_ARGS --concurrency=1 and the pre-push gate passed on every one of those same four pushes.

Fix shape: have the root `test` script pass --concurrency=1 to turbo when LOW_RESOURCE_MODE=1, matching what pre-push already does at .husky/pre-push:110. Note package.json:20 has a `test:low-mem` script that sets --workspace-concurrency=1, but it drives pnpm filters rather than turbo, so it is a different path and does not fix `pnpm test`.

Why it matters: a false red on the standing pre-commit gate trains people to retry rather than read, which is exactly how a real failure gets waved through. It also costs a couple of minutes per verification cycle.

Acceptance: `pnpm test` completes green in one pass on this machine with LOW_RESOURCE_MODE=1 set, without a retry, on a change touching a service package; and the mechanism note above lands wherever the low-resource contract is documented so the vitest-vs-turbo distinction is not rediscovered.
<!-- SECTION:DESCRIPTION:END -->
