---
id: TASK-1043
title: >-
  ArchivePromotionScheduler first tick after a deploy hits the OLD gateway —
  retry once before posting the failure embed
status: To Do
assignee: []
created_date: '2026-09-22 14:16'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1037000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: dev 2026-09-22 13:53:40Z — the bot-client scheduler ticked 60 s after its container started (STARTUP_DELAY_MS in services/bot-client/src/services/ArchivePromotionScheduler.ts) and got "Route POST /api/admin/memory-archive/promote not found"; the api-gateway container for the same commit logged "Starting Container" at 13:55:09Z. Railway keeps the old gateway serving until the new one is up, so a first tick that calls a route NEW in the same deploy is answered by the old build. Existing routes are unaffected; the same one-off false alarm will fire on prod at the beta.229 cut.
Fix shape: on the first tick after start, treat a route-not-found (404) result as "gateway not on this build yet" — log a warn and reschedule one retry after ~5 min; post the failure embed only if the retry fails too. Either in the scheduler itself or as an opt-in on createIntervalScheduler (packages/common-types/src/utils/intervalScheduler.ts) so the other schedulers can adopt it when they gain a new route. Acceptance: a unit case where the first run returns the 404 error and the retry succeeds posts no failure embed; a case where both fail posts one.
<!-- SECTION:DESCRIPTION:END -->
