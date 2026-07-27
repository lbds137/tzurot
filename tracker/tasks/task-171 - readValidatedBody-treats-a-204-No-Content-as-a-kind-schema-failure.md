---
id: TASK-171
title: "readValidatedBody treats a 204 No Content as a kind: 'schema' failure"
status: To Do
assignee: []
created_date: '2026-06-24 00:00'
labels:
  - 'area:clients'
dependencies: []
ordinal: 171000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`readValidatedBody` treats a 204 No Content as a `kind: 'schema'` failure

**Why:** `readValidatedBody` (`packages/clients/src/clients/transport.ts`) calls `response.json()` unconditionally on any 2xx, so a 204 (empty body) throws and surfaces as `kind: 'schema'` / `status: 0` — indistinguishable from a malformed body — even though the mutation succeeded. **Latent today**: no gateway route returns 204, so it's unreachable until one does, but the silent-failure shape is more consequential now that callers branch on the `kind` discriminant. **Fix shape**: guard `if (response.status === 204) return { ok: true, data: null };` before the `response.json()` call; add a transport test for the 204 path. **Promote when**: a gateway route is added that returns 204 (or any empty-body 2xx), OR next touching `readValidatedBody`. Surfaced 2026-06-24 by PR #1324 release review (round 2).
<!-- SECTION:DESCRIPTION:END -->
