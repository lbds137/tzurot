---
id: TASK-277
title: Reconcile fetcher single-page assumption (per_page=30)
status: Done
assignee: []
created_date: '2026-07-15 00:00'
updated_date: '2026-08-10 14:01'
labels:
  - 'origin:review'
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 277000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Reconcile fetcher single-page assumption (per_page=30) — `createGitHubReleasesFetcher` pulls one newest-first page of 30 and assumes that covers any allowed lookback window (≤168h) — true at current cadence, but a hotfix burst pushing an unannounced release past position 30 would silently drop it from the sweep (quiet failure mode; #1651 review obs 2). **Fix shape**: follow the `Link: rel="next"` header while the page's oldest release is still inside the window, or simply log a warn when item 30 is younger than the cutoff (cheap tripwire). **Promote when**: release cadence ever exceeds ~30 releases/week, or the next `releaseReconcile.ts` touch. Surfaced 2026-07-15 (#1651 review).

**Why:** The cheap tripwire beats speculative pagination while cadence is ~3/week.
<!-- SECTION:DESCRIPTION:END -->
