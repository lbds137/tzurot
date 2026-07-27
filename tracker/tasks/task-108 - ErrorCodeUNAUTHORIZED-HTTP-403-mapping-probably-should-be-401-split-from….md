---
id: TASK-108
title: 'ErrorCode.UNAUTHORIZED → HTTP 403 mapping (probably should be 401) + split from…'
status: To Do
assignee: []
created_date: '2026-05-18 00:00'
labels:
  - 'area:api-gateway'
dependencies: []
ordinal: 108000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`ErrorCode.UNAUTHORIZED` → HTTP 403 mapping (probably should be 401) + split from `forbidden()`

**Why:** `services/api-gateway/src/utils/errorResponses.ts:20` maps `UNAUTHORIZED` → 403; per RFC 7235 it should be 401. `ErrorResponses.unauthorized` and `.forbidden` both wrap `UNAUTHORIZED`, so a naive flip breaks `forbidden()`. Paired fix: add `ErrorCode.FORBIDDEN` (→ 403), point `forbidden()` at it, flip `UNAUTHORIZED` → 401. ~15-20 LOC + test updates. No current user-visible bug (clients don't distinguish 401/403 in our context). **Promote when**: any API consumer reports auth-required vs auth-insufficient confusion, OR when next touching errorResponses.ts. Surfaced 2026-05-18 by PR #1051. Deferred 2026-05-19.
<!-- SECTION:DESCRIPTION:END -->
