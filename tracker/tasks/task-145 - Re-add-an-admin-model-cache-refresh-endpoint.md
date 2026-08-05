---
id: TASK-145
title: Re-add an admin model-cache-refresh endpoint
status: To Do
assignee: []
created_date: '2026-06-15 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:api-gateway'
  - 'area:bot-client'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 145000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Re-add an admin model-cache-refresh endpoint

**Why:** The `POST /models/refresh` (owner-only force-refresh of `OpenRouterModelCache`) was dropped with the root `/models` router in #1213 — it had no source caller. The cache self-refreshes on a 24h TTL, so there's currently no manual escape valve if the prod model list goes stale mid-day (e.g. a new model launches and isn't pickable until the TTL rolls). **Fix shape**: add `POST /api/admin/models/refresh` as an admin manifest route (audience `admin`, `requireOwnerAuth`) calling `modelCache.refreshCache()`. **Promote when**: a stale-model-list incident is observed in prod, or the 24h TTL becomes operationally painful. Surfaced 2026-06-15 by PR #1213 (review flagged the capability drop; backlog tracks re-add). Deferred 2026-06-15.
<!-- SECTION:DESCRIPTION:END -->
