---
id: TASK-655
title: Stryker 10 major bump needs its own PR plus a baseline refresh
status: To Do
assignee: []
created_date: '2026-08-18 10:55'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 655000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: dependabot PR 2137 (dev-deps group, 20 updates) is RED on mutation-tests. config-resolver scored 85.97 against floor 86.17 (baseline 87.17), 77 undetected mutants. The cause is not a test-quality regression — the same PR bumps @stryker-mutator/api, /core and /vitest-runner from 9.6.1 to 10.0.0. A Stryker major changes which mutants are generated, so the score is measured against a different mutant population than the baseline was.

That makes this the sanctioned mutation:update-baseline case rather than the close-the-gaps case (05-tooling distinguishes them: never hand-edit a baseline on a genuine drop, but a measurement-basis change is different). The refresh requires a fresh LOCAL Stryker report for EVERY tracked package in MUTATED_PACKAGES, and heavy local test runs are the known OOM risk on this machine — the CI job runs all packages in about 4.5 minutes, so locally it is plausible but wants care.

Why separate from 2137: bundling a major test-infrastructure upgrade with 19 unrelated dev-dep bumps means the baseline refresh rides a PR nobody would review as an infrastructure change, and a red ratchet is the only thing currently making it visible.

Also unread: Stryker 10 breaking changes. Its config surface may have changed; the ratchet reads reports/mutation/<pkg>/ and mutation-check.ts compiles per-package config, so a format change would surface as a confusing failure rather than a clean one. Read the v10 migration notes before running anything.

Fix shape: take Stryker 10 as its own branch, read the v10 breaking changes, run test:mutation for every tracked package locally, run mutation:update-baseline, and land it with the score deltas stated per package in the PR body so the new numbers are a recorded decision rather than a silent ratchet move. Then let dependabot re-open the remaining dev-deps group.

Acceptance: Stryker 10 on develop, mutation:check green, and the PR body names each tracked package old score to new score with the mutant-population change as the stated reason.
<!-- SECTION:DESCRIPTION:END -->
