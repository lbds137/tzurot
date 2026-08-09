---
id: TASK-463
title: >-
  collectRepoSettings has no aggregate timeout budget across its per-ruleset
  fetches
status: Done
assignee: []
created_date: '2026-08-07 22:30'
updated_date: '2026-08-09 01:52'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 462000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: collectRepoSettings calls ghApi once for repo settings, once for the ruleset list, and once PER ruleset id — each with its own independent 30s GH_TIMEOUT_MS. A repo with many active rulesets plus a slow or flaky gh compounds into minutes of sequential waiting before the surface degrades to unavailable, instead of failing fast against one overall budget.

Low impact today: the two call sites (release preflight, weekly ops health) tolerate latency, and this repo has 2 rulesets. It matters if the guard ever moves somewhere latency-sensitive, or if the ruleset count grows.

Fix shape: one deadline computed at entry, checked before each subsequent fetch; on expiry degrade to unavailable with a reason naming the timeout rather than the last gh error.

Surfaced by the PR #2001 review (LOW, non-blocking).
<!-- SECTION:DESCRIPTION:END -->
