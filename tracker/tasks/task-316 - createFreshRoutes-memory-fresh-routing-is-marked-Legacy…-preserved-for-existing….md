---
id: TASK-316
title: Confirm which memory-fresh routing path prod mounts; delete the dead one
status: To Do
assignee: []
created_date: '2026-07-22 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'origin:review'
  - 'area:api-gateway'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 316000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-22 (#1761 release-review) — `createFreshRoutes` (memory `fresh` routing) is marked "Legacy… preserved for existing wiring" but its JSDoc is ambiguous about which path prod actually mounts: the generated `mounts.ts` path vs. this factory. Risk: two routing paths silently drift, or one is unnoticed dead code. **Fix shape**: confirm which path is mounted in prod; delete the dead one (or clarify the JSDoc if both are intentionally live). **Promote when**: the next memory-routing touch, or a fresh/incognito route bug that could stem from path divergence.

**Why:** Cheap to verify; ambiguous dual-path wiring is a latent maintenance trap, not a live bug.
<!-- SECTION:DESCRIPTION:END -->
