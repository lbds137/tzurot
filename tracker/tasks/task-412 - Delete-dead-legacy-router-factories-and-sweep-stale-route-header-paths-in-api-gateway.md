---
id: TASK-412
title: >-
  Delete dead legacy router factories and sweep stale route-header paths in
  api-gateway
status: Done
assignee: []
created_date: '2026-08-03 18:27'
updated_date: '2026-08-03 23:37'
labels:
  - 'size:M'
dependencies: []
priority: medium
ordinal: 412000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the pre-cutover aggregator mounts are gone, but their router factories survive as test-only or zero-importer dead code (denylist createDenylistRoutes, cleanup createCleanupRoute, dbSync createDbSyncRoute, wallet/removeKey, personality/index createPersonalityRoutes, channel/index createChannelRoutes, and the tts-override/model-override/voices factories with zero importers at all). Their in-file route-ordering comments (default-before-param) describe an invariant now owned by sortRoutesForExpress in _generated/mounts.ts, so the invariant is documented in two places with only one real. Separately, ~35 route header docblocks still declare pre-cutover paths (POST /wallet/set, /admin/diagnostic/*, etc.) instead of the mounted /api/{user,admin,internal} forms. Surfaced by the 2026-08-03 drift audit; related: TASK-411 (the denylist factory carries the orphaned rate limiter).
Fix shape: delete the factories and retarget their tests at the bare handlers; then sweep every route-file header to its real mounted path using _generated/mounts.ts as the source of truth.
Acceptance: no router factory without a production importer; knip clean; every route header states the path mounts.ts actually serves.
<!-- SECTION:DESCRIPTION:END -->
