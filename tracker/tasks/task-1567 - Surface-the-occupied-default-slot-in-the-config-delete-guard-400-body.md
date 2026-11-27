---
id: TASK-1567
title: Surface the occupied default slot in the config delete-guard 400 body
status: To Do
assignee: []
created_date: '2026-11-27T05:33:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1560000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: split from TASK-188 on the owner split ruling 2026-11-27 (pilot re-rate; the 2026-08-14 TASK-599 decision owner-approved surfacing the occupied slot). Today an admin who sets globalDefaultLlmConfigId or freeDefaultVisionConfigId gets success:true with no live resolution effect (no resolver tier consults them - TASK-188 holds the tier wirings) AND the pointer-aware delete guard then blocks deleting that config - invisible friction with no feedback. Fix shape: when the delete guard refuses because a default pointer occupies the config, name the occupied slot in the 400 body (which pointer, which config id) so the admin can see why. Acceptance: the delete-guard 400 names the occupied slot; a test pins the body shape.
<!-- SECTION:DESCRIPTION:END -->
