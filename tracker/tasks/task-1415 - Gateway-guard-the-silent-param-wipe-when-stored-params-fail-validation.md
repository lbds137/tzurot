---
id: TASK-1415
title: 'Gateway: guard the silent param wipe when stored params fail validation'
status: To Do
assignee: []
created_date: '2026-11-13T01:33:00Z'
labels:
  - area:api-gateway
  - state:observable
  - size:S
dependencies: []
priority: low
ordinal: 1403000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 2746 round-3 review Low 2: safeValidateAdvancedParams is all-or-nothing (LlmConfigService.ts:601 builds detail params as safeValidateAdvancedParams(raw.advancedParameters) ?? {}), so one invalid stored key blanks the whole params object in the detail response. NARROWED 11-13 post-merge (round-5 review): the name-only wipe is FIXED by 2746 round 5 (the dirty gate omits the key on non-param edits) — what remains here is a REAL param edit over an unparseable blob: the dirty gate fires on the changed key, the rebuilt object drops the blob's valid keys, and wholesale replace erases them. (The expired-session wipe is a separate seam: TASK-1418.) This task holds the gateway-side guard. Options: a paramsInvalid marker on the detail so the client warns before sending a partial object, or per-key valid-subset in safeValidateAdvancedParams. Promote when: a schema bound tightens (making previously-stored params invalid) or a user reports a silent param wipe.
<!-- SECTION:DESCRIPTION:END -->
