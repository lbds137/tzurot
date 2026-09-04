---
id: TASK-134
title: Forensic audit trail for non-owner diagnostic-log 404 lookups
status: To Do
assignee: []
created_date: '2026-05-23 00:00'
updated_date: '2026-09-04 19:45'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 134000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Forensic audit trail for non-owner diagnostic-log 404 lookups

**Why:** The server-side 404-not-403 design for `GET /api/internal/diagnostic/:requestId` correctly hides existence from non-owners, but loses the only signal for detecting enumeration probing (a user iterating `requestId`s). `handleGetByRequestId`'s extended-WHERE `findUnique` returns null for both "doesn't exist" and "exists but not yours," so the handler cannot distinguish at all. The reviewer's suggested mitigation (a debug log on every non-owner 404) is a noisy false-positive tradeoff vs. zero signal. **Fix shape**: a sampled count-only secondary query for non-owner 404s, or a separate structured audit-log table — needs a proper threat-model design pass. **Promote when**: enumeration probing is observed in production, OR a feature requires forensic visibility into denied diagnostic accesses. Surfaced 2026-05-23 PR #1087 round 6; carried over from current-focus when the typed-client epic closed 2026-05-30.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:45
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: ARCHIVED. ruled out on merit (C8): the 404-not-403 shape is the correct privacy posture; a forensic trail buys enumeration detection that cannot be acted on at single-instance scale and adds a write to a read path. Ids are UUIDs on a user-authed endpoint.
---
<!-- COMMENTS:END -->
