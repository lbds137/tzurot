---
id: TASK-417
title: >-
  Delete the dead user/channel and user/personality factory index files and
  their handler-builder tier
status: Done
assignee: []
created_date: '2026-08-03 23:10'
updated_date: '2026-08-04 01:22'
labels:
  - 'size:M'
  - 'area:api-gateway'
dependencies: []
ordinal: 417000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-412 (PR pending) deleted 27 dead router factories but STOPPED at user/channel/index.ts and user/personality/index.ts because the dead factory is each file's only export. Deleting them orphans 12 create*Handler builders across 12 files (auth-middleware + handler-array bundles consumed only by these two index files) and requires retargeting ~10 test files (channel/{activate,configOverrides,deactivate,get,list,updateGuild}.test.ts, personality/{create,delete,get,index,list,update,visibility}.test.ts) at the bare handlers, the same shape as the TASK-412 retargets.

Fix shape: delete both index.ts files + the create*Handler exports; retarget the tests via asRouteHandler in shared-route-test-utils; the two files' stale headers die with them.

Acceptance: zero create* factories under routes/{user,admin,wallet} without production importers except admin/denylist.ts (TASK-411 carve-out); api-gateway typecheck+test+lint green.
<!-- SECTION:DESCRIPTION:END -->
