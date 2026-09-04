---
id: TASK-780
title: >-
  ops wrapper for the SHA-pinned runs query - print the not-indexed-yet caveat
  on empty results
status: To Do
assignee: []
created_date: '2026-08-27 01:20'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 780000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the empty-runs-query-read-as-absence miss recurred 2026-08-26 (an empty actions/runs?head_sha result minutes after a push was read as proof the review workflow never dispatched - cost two CI cycles and an owner escalation) even though 05-tooling.md documents the not-indexed-yet caveat. The warning lives in the doc, not at the point of use.

Fix shape: add pnpm ops gh:runs-for-sha (default HEAD, --sha override) wrapping the actions/runs?head_sha=... query. When the result is EMPTY and the commit is younger than ~10 minutes (git show -s --format=%ct), print a NOT-INDEXED-YET warning naming the re-query rule instead of bare empty output; otherwise print the run list as the raw query does. Update 05-tooling.md § PR Monitoring to name the wrapper as the decision-point tool for the run-list check.

Acceptance: empty result within the freshness window prints the caveat; empty result on an old commit does not; populated results pass through unchanged; unit test covers all three.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Confirmed no such wrapper exists yet — the exact failure mode it would prevent (an empty `actions/runs?head_sha=...` result misread as "review workflow never dispatched") is documented as having recurred once already after the doc-only fix, costing two CI cycles and an owner escalation. Evidence: `git grep -n "runs-for-sha" packages/tooling/src` → 0 matches.
---
<!-- COMMENTS:END -->
