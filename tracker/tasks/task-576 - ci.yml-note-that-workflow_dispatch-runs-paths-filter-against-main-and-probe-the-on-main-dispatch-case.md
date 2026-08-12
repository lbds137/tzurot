---
id: TASK-576
title: >-
  ci.yml: note that workflow_dispatch runs paths-filter against main, and probe
  the on-main dispatch case
status: To Do
assignee: []
created_date: '2026-08-12 22:39'
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
