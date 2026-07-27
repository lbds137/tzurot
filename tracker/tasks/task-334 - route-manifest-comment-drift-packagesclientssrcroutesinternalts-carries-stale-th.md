---
id: TASK-334
title: 'route-manifest comment drift: packages/clients/src/routes/internal.ts carries stale "the…'
status: To Do
assignee: []
created_date: '2026-07-27 00:00'
labels:
  - 'area:clients'
dependencies: []
ordinal: 334000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-27 (system-model pre-work scouts; owner: known lies need backlog items) — **route-manifest comment drift**: `packages/clients/src/routes/internal.ts` carries stale "the cutover relocates this" comments for routes whose cutover already happened, and `admin.ts` has the `cleanup` docblock sitting above the `broadcast` route. **Fix shape**: tiny chore PR correcting/deleting the comments; remove the map §4 entry. **Promote when**: next clients-package touch, or fold into the drift-audit remediation.

**Why:** Comments describing moved behavior actively mislead the next reader of the manifest.
<!-- SECTION:DESCRIPTION:END -->
