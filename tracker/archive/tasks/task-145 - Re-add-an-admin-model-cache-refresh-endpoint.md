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

## Comments

<!-- COMMENTS:BEGIN -->
author: backlog-pilot
created: 2026-11-26 23:47
---
CLOSED OBSOLETE (backlog pilot, 50-oldest sweep). The stale-mid-day window this endpoint guarded against no longer exists: `services/api-gateway/src/services/ModelCatalogRefresher.ts` keeps the catalog continuously fresh on a scheduled TTL/3 refresh (line 63) and is wired into service startup (services/api-gateway/src/index.ts:297, lifecycle stop at :617). Its module header records the exact prod incident this task's promote-when anticipated ("Observed in production: the key was absent outright") — and the shipped fix was the scheduler, not an endpoint. Endpoint absence verified 2026-11-26: grep `models/refresh|forceRefresh` across services/api-gateway/src → 0 hits; no model route in the admin mount table. CAVEAT for the owner: an on-demand force-refresh was never re-added — if still wanted as an admin escape hatch post-scheduler, that is a NEW small ask, not this task. Archived with reason in the removing commit; `pnpm tracker task restore 145` reverses.
---
<!-- COMMENTS:END -->
