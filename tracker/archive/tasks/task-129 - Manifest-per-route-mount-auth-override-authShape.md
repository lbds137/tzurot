---
id: TASK-129
title: Manifest per-route mount-auth override (authShape)
status: To Do
assignee: []
created_date: '2026-05-29 00:00'
updated_date: '2026-09-04 19:43'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 129000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Manifest per-route mount-auth override (`authShape`)

**Why:** The route-manifest codegen (`packages/tooling/src/codegen/mounts-builder.ts`) hard-codes one uniform middleware chain per audience (`internal` → none, `admin` → `requireUserAuth`+`requireOwnerAuth`, `user` → `requireUserAuth`). There is no per-route way to express a non-standard chain like "service-OR-owner" at the mount. The GatewayClient-dissolution PR needed exactly that for admin-settings service reads and solved it with an **internal-audience alias** (`getAdminSettingsInternal` reusing `handleGetAdminSettings`) — clean, zero generator changes. A general `authShape` field on `RouteDef` (+ builder support + invariant tests) would only pay off if a SECOND route needs a bespoke mount-auth shape that the alias trick can't express. **Fix shape**: add an optional `authShape` (or `mountMiddleware`) field to `RouteDef`; teach `buildMountCall`/`buildMountFunction` to emit it; add manifest-invariant tests; document when to use it vs. the alias pattern. **Why deferred**: explicitly rejected for the dissolution PR — the alias pattern covered the need with far less surface, and YAGNI applies until a second case appears. **Promote when**: a second route genuinely needs mount-level service-or-owner (or other non-standard) auth that an internal-alias can't model. Surfaced 2026-05-29 during the GatewayClient-dissolution design. Deferred 2026-05-29.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:43
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: ARCHIVED. admission bar (06-backlog.md: there is deliberately no state for the-only-trigger-is-next-time-someone-touches-this; a task in it should never have been filed). The trigger event and the need are the same diff: a second route needing bespoke mount auth is written against the first.
---
<!-- COMMENTS:END -->
