---
id: TASK-315
title: 'the IsAdmin brand (common-types/ownerMiddleware) is applied to ONE function today:…'
status: To Do
assignee: []
created_date: '2026-07-22 00:00'
labels:
  - 'area:common-types'
  - 'origin:review'
dependencies: []
ordinal: 315000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-22 (#1757 review) — the `IsAdmin` brand (common-types/ownerMiddleware) is applied to ONE function today: `getCharacterDashboardConfig`'s admin gate. `DashboardContext.isAdmin` and `isBotOwner`'s return stay plain `boolean` (deliberate — branding isBotOwner would churn ~40 mocks). Two thin spots: (a) a future admin-gated config for another entity (persona/preset/…) could reinvent a plain-`boolean` isAdmin param and re-open the canEdit-vs-isAdmin leak class — the next author should reuse `IsAdmin`, not a fresh boolean; (b) the `asIsAdmin` escape hatch can't stop `asIsAdmin(character.canEdit)` (JSDoc warns, but it's social). **Fix shape**: when the 2nd admin-gated entity config lands, type its gate `IsAdmin` and (if `asIsAdmin(` call sites multiply) consider an ESLint rule flagging `asIsAdmin(<expr containing canEdit>)`. **Promote when**: a second admin-gated dashboard/config function is added, or `asIsAdmin` grows past ~2 call sites.

**Why:** One branded param today is enough; generalize when a second consumer proves the pattern.
<!-- SECTION:DESCRIPTION:END -->
