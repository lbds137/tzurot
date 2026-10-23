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
<!-- SECTION:DESCRIPTION:END -->
