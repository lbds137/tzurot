---
id: TASK-576
title: >-
  ci.yml: note that workflow_dispatch runs paths-filter against main, and probe
  the on-main dispatch case
status: Done
assignee: []
created_date: '2026-08-12 22:39'
updated_date: '2026-09-25 00:41'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 576000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: dorny/paths-filter with no base: input diffs the push range on push events but the repository default branch on other events - a dispatched run on a feature branch computes changed-files vs main (superset: gated jobs over-run, safe direction). The ambiguous case is dispatching on main itself (base == current ref on a non-push event; possibly empty diff -> smoke jobs silently skip) - unprobed. One comment line in ci.yml plus a probe of the on-main case.

Source: 2026-08-12 review, health F9 PLAUSIBLE (library behavior from docs memory).

PROBE RESULT 2026-09-24 (owner said yes): the premise above is WRONG for dispatched runs, and the real behavior is worse than a comment can fix. Dispatched `ci.yml` on main at 9cb29c9c4 (run 36053808826). In the voice-engine-tests job, paths-filter logged `'before' field is missing in event payload - changes will be detected from last commit`, then ran `git log --format= --no-renames --name-status -z -n 1`. It found 1 changed file (CURRENT.md, the tip commit's only file) and set `Filter voice-engine = false`. Every gated step (Setup Python, ruff, mypy, tests, coverage) was SKIPPED while the job reported success. docker-build-smoke (ai-worker) showed the same: Build image skipped, job green. So a dispatched run diffs ONLY THE TIP COMMIT. It does not diff the default branch, and it is not an empty diff. A manual "run everything" dispatch silently skips voice-engine and every Docker smoke leg unless the last commit happened to touch their paths.
Unverified: whether a dispatch on a FEATURE branch behaves the same. Code-reading suggests it does: the warning keys on the missing `before` field, and no workflow_dispatch payload carries one. The "superset vs main" claim above therefore likely does not hold either.
Corrected fix shape: make the filter-gated steps in voice-engine-tests and docker-build-smoke run unconditionally on workflow_dispatch, e.g. `if: steps.filter.outputs.<name> == 'true' || github.event_name == 'workflow_dispatch'`. A manual dispatch is by definition a request to run everything. Add a one-line comment naming this probe's finding. `ci.yml` is not a claude workflow file, so it rides develop in an ordinary PR. Acceptance: a dispatched run on main executes the gated steps (re-dispatch after merge, then read the step conclusions).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. No comment covering this exists in `ci.yml` yet, and no evidence the on-main dispatch case was probed. Evidence: `grep -n "paths-filter\|workflow_dispatch" .github/workflows/ci.yml` → existing paths-filter comments are about shallow-clone depth, not the base-ref ambiguity this task names.
---
<!-- COMMENTS:END -->
