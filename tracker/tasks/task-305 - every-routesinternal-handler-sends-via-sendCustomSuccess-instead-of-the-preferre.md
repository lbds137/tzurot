---
id: TASK-305
title: Sweep routes/internal to sendContractSuccess
status: To Do
assignee: []
created_date: '2026-07-23 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'origin:review'
  - 'area:api-gateway'
  - 'size:S'
dependencies: []
priority: low
ordinal: 305000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-23 (retention 1d, #1767 review) — every `routes/internal/*` handler sends via `sendCustomSuccess` instead of the preferred `sendContractSuccess`, which pins the response to the manifest's declared `output` schema at compile time (`responseHelpers.ts` documents the preference for routes with a manifest entry). Class-wide: `dmSessionSet`, `usersRecent`, `usersActivity`, `secretRotationStatus`, and the rest. **Fix shape**: sweep the internal handlers to `sendContractSuccess(res, <Schema>, data)` — a mechanical swap that adds compile-time output-schema pinning. **Promote when**: next internal-routes touch, or a response-shape drift bug.

**Why:** Reviewer flagged it as a class-wide follow-up sweep, not a one-off; fixing only the new route would deviate from the family.
<!-- SECTION:DESCRIPTION:END -->
