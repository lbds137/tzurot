---
id: TASK-1043
title: >-
  ArchivePromotionScheduler first tick after a deploy hits the OLD gateway —
  retry once before posting the failure embed
status: Done
assignee: []
created_date: '2026-09-22 14:16'
updated_date: '2026-09-23 14:04'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1037000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: dev 2026-09-22 13:53:40Z — the bot-client scheduler ticked 60 s after its container started (STARTUP_DELAY_MS in services/bot-client/src/services/ArchivePromotionScheduler.ts) and got "Route POST /api/admin/memory-archive/promote not found"; the api-gateway container for the same commit logged "Starting Container" at 13:55:09Z. Railway keeps the old gateway serving until the new one is up, so a first tick that calls a route NEW in the same deploy is answered by the old build. Existing routes are unaffected; the same one-off false alarm will fire on prod at the beta.229 cut.
Fix shape: on the first tick after start, treat a route-not-found (404) result as "gateway not on this build yet" — log a warn and reschedule one retry after ~5 min; post the failure embed only if the retry fails too. Either in the scheduler itself or as an opt-in on createIntervalScheduler (packages/common-types/src/utils/intervalScheduler.ts) so the other schedulers can adopt it when they gain a new route. Acceptance: a unit case where the first run returns the 404 error and the retry succeeds posts no failure embed; a case where both fail posts one.

SECOND SHAPE OBSERVED 2026-09-23 02:50Z (dev, owner screenshot of the log channel): "Memory archive promotion check failed — fetch failed" at 10:50 PM EDT, the same minute as the GitHub deployment status `success` for 4405beacc (#2483; statuses in_progress 02:47:29Z to success 02:50:18Z). This was a network-level failure against a gateway mid-rollover, on a route that already existed. That falsifies "existing routes are unaffected" above: the first tick can land in the deploy window for ANY route, so this false alarm can fire on any deploy where the bot-client first tick lands before the new gateway is serving, which on dev means any develop push that redeploys the services. Fix shape widened: on the first tick, treat BOTH a 404 route-not-found AND a transport error (fetch failed / ECONNREFUSED / 502-503 from the edge) as "gateway not ready" and retry once after ~5 min; post only if the retry fails too. Add a unit case for the transport-error shape. Priority raised to medium: the cost is measured, as a recurring false failure embed in the owner log channel that trains the owner to ignore real ones.
<!-- SECTION:DESCRIPTION:END -->
