---
id: TASK-1273
title: 'test:mutation-scoped failure diagnosability + backstop anchoring, nits'
status: To Do
assignee: []
created_date: '2026-10-23 23:41'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1261000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the round-6 review on PR 2644 (review-round cap reached, none blocking, filed at merge). Medium: Stryker logs failure reasons to STDOUT but the runner catch keeps only error.message - on failure the operator sees Command failed with no reason. Fix: print the last ~40 lines of error.stdout on the catch path, pinned by a stubbed-throw test. Low: diffHasAddedLineHunks predicates are unanchored includes across every diff line, so a delete-only diff whose content carries diff-fixture text (this repo ships such test files) false-fails with the blinding error. Fix: anchor to line.startsWith plus the anchored hunk regex, add a content-bearing delete-only test. Nits: merge overlapping ranges in buildPlans or mark the overlap fixture synthetic; print the resolved merge-base SHA so a stale origin/develop scope is visible; the OPS_CLI_REFERENCE row should say the package set is manifest-derived, not MUTATED_PACKAGES.

Anthropic post-merge re-review addition (2026-10-25, code-reading, not runtime-confirmed). Medium: the gate can pass vacuously. (a) When every changed mutable line sits in a skipped package (services, no Stryker deps, no stryker.config.mjs) the skips print as notes and the run ends with the success tick (mutation-scoped.ts ~323-326); (b) a planned package returning generated === 0 passes, so a -m range that stops matching (path-form drift) reads as a green 0 mutants (~231-251). Fix: a distinct non-success line or a failure when source lines were all skipped, and a failure when a plan with non-comment ranges yields 0 mutants, each pinned by a test. Low: summarizeReport(JSON.parse(...)) at ~232 sits outside the try, so a truncated report crashes with a raw stack (still fails closed); parseGitDiff ignores the quoted +++ b/ form (latent: pathspec is space-free today, and a partial drop escapes the empty-parse backstop); the gate reads base...HEAD only and the dirty-tree check merely warns, so a staged-only change reports nothing to run.
<!-- SECTION:DESCRIPTION:END -->
