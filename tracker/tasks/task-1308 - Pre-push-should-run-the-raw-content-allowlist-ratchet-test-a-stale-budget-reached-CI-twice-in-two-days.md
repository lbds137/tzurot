---
id: TASK-1308
title: >-
  Pre-push should run the raw-content allowlist ratchet test (a stale budget
  reached CI twice in two days)
status: To Do
assignee: []
created_date: '2026-10-27T13:50:00Z'
labels:
  - area:husky
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1292000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the shrink-only budget test packages/tooling/src/eslint/raw-content-allowlist.test.ts (budgets stay exact) is a tooling unit test, so a change in bot-client that moves a file raw-literal count only fails it in CI: PR 2668 (Mon 10-26, tooling raw-content ratchet red after removing a raw string) and PR 2672 (Tue 10-27, factsBrowse.ts budget 1, actual 0 after routing copy through a per-reason map). Each cost a CI cycle. The pre-push hook runs bot-client and lint gates but not this test, and a note in the role file did not prevent the repeat, so it needs a mechanical trigger.

What: add the ratchet test to the pre-push checks (it runs in a few seconds: 4 tests, one live staleness sweep of about 2 seconds), run whenever the diff touches services/ or packages/*/src; keep it in the husky hook registry and add its hook probe per the guard-hook-probes rules (05-tooling.md Guards). Edit lands via PR (.husky is review-gated).

Acceptance: a branch whose change leaves a stale budget fails at pre-push with the ratchet message; a clean branch adds no more than a few seconds; hook probe added and green.
<!-- SECTION:DESCRIPTION:END -->
