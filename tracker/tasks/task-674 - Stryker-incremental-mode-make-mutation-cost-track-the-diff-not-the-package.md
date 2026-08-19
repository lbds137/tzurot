---
id: TASK-674
title: 'Stryker incremental mode: make mutation cost track the diff, not the package'
status: To Do
assignee: []
created_date: '2026-08-19 02:47'
labels:
  - 'area:ci'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 674000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner question 2026-08-19 -- can Stryker be scaled or parallelised in CI. Measured today across ten CI runs: the mutation-tests job takes ~40s when mutation:gate skips it and ~6-7min when it actually runs, five tracked packages sequentially in one job at STRYKER_CONCURRENCY=4 (ubuntu-latest has 4 vCPU, so concurrency is already matched to the runner).

PROBED, not assumed: Stryker 9.6.1 supports --incremental, --incrementalFile <file> and --force. Help text confirms it stores results and reuses them to speed the next run; --force rebuilds the file.

WHY THIS BEATS THE MATRIX SPLIT (TASK-300): the matrix caps worst-case wall-clock at setup + slowest package (~3min vs ~7min) and PAYS 5x SETUP -- checkout at fetch-depth 0, pnpm install, prisma generate and a package build, per leg. Incremental instead shrinks the WORK: unchanged mutants are not re-run at all, so cost tracks the diff rather than the package. No fan-out plumbing, no extra setup, and the two compose if both are ever wanted.

THE SEMANTIC POINT THAT MATTERS MOST, and the reason this is not interchangeable with TASK-673 diff-scoped run: mutation:check compares a per-package AGGREGATE score against .github/baselines/mutation-baseline.json. Incremental mode still produces a COMPLETE score (it reuses prior results for untouched mutants), so the ratchet keeps working unchanged. A --mutate glob scoped to the diff produces a PARTIAL score that is not baseline-comparable and would silently break the ratchet if pointed at it. Two different tools for two different jobs: incremental for the ratchet, diff-scoped for catching vacuous new assertions (TASK-673). Do not conflate them.

THE REAL PRIZE: this is what makes tracking MORE packages affordable. packages/tooling is currently untrackable at 39,001 source lines (largest tracked is clients at 7,882; all five combined are 15,704) because a full run is prohibitive. With incremental, steady-state cost is proportional to the change rather than the package, which changes the viability calculus for every candidate package -- and TASK-673 wants tooling covered.

It also invalidates TASK-300 promote-when: that task says promote the matrix when a 6th package joins because sequential wall-clock grows linearly. Under incremental it does not grow linearly -- it grows with the diff -- so the matrix may never be needed. Note appended there.

Fix shape:
- Add --incremental plus an explicit --incrementalFile per package under a cached path.
- Persist via actions/cache. The cache KEY design is the whole risk: too loose and a stale file masks real changes, too tight and it never hits. Key it on something that changes when measurement semantics change -- the existing getMutationConfigFingerprint is exactly that object and already exists.
- Run --force on develop and main pushes to rebuild the file from scratch, so the cached state is periodically re-grounded rather than accumulating drift forever.
- Verify the score is unchanged between a --force run and an incremental run on the same commit BEFORE trusting it against the baseline. That is the acceptance-critical check: if incremental and full disagree on the score, the ratchet is being fed a lie.

Acceptance: an incremental run and a --force run on the same commit produce the same per-package score; a typical PR touching one tracked package completes materially faster than the ~6-7min measured today, with the figure stated; the cache key is tied to the config fingerprint so a measurement-semantics change cannot reuse a stale file.
<!-- SECTION:DESCRIPTION:END -->
