---
id: TASK-134
title: Forensic audit trail for non-owner diagnostic-log 404 lookups
status: To Do
assignee: []
created_date: '2026-05-23 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:api-gateway'
  - 'size:S'
dependencies: []
priority: low
ordinal: 134000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Forensic audit trail for non-owner diagnostic-log 404 lookups

**Why:** The server-side 404-not-403 design for `GET /api/internal/diagnostic/:requestId` correctly hides existence from non-owners, but loses the only signal for detecting enumeration probing (a user iterating `requestId`s). `handleGetByRequestId`'s extended-WHERE `findUnique` returns null for both "doesn't exist" and "exists but not yours," so the handler cannot distinguish at all. The reviewer's suggested mitigation (a debug log on every non-owner 404) is a noisy false-positive tradeoff vs. zero signal. **Fix shape**: a sampled count-only secondary query for non-owner 404s, or a separate structured audit-log table — needs a proper threat-model design pass. **Promote when**: enumeration probing is observed in production, OR a feature requires forensic visibility into denied diagnostic accesses. Surfaced 2026-05-23 PR #1087 round 6; carried over from current-focus when the typed-client epic closed 2026-05-30.
<!-- SECTION:DESCRIPTION:END -->
