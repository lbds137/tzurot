---
id: TASK-576
title: >-
  ci.yml: note that workflow_dispatch runs paths-filter against main, and probe
  the on-main dispatch case
status: To Do
assignee: []
created_date: '2026-08-12 22:39'
updated_date: '2026-09-04 19:37'
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
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. No comment covering this exists in `ci.yml` yet, and no evidence the on-main dispatch case was probed. Evidence: `grep -n "paths-filter\|workflow_dispatch" .github/workflows/ci.yml` → existing paths-filter comments are about shallow-clone depth, not the base-ref ambiguity this task names.
---
<!-- COMMENTS:END -->
