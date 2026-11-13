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
PR 2746 round-3 review Low 2: safeValidateAdvancedParams is all-or-nothing (LlmConfigService.ts:601 builds detail params as safeValidateAdvancedParams(raw.advancedParameters) ?? {}), so one invalid stored key blanks the whole params object in the detail response. Any dashboard edit then sends advancedParameters as an empty object (the presence gate always fires post-2746) and the gateway wholesale replace silently deletes the stored blob including its valid keys - the dashboard showed an empty form, so the user gets no warning. Disposition on 2746: documented as intended clearing of invalid data; this task holds the real guard. Options: a paramsInvalid marker on the detail so the client warns before sending an empty object, or per-key valid-subset in safeValidateAdvancedParams. Promote when: a schema bound tightens (making previously-stored params invalid) or a user reports a silent param wipe.
<!-- SECTION:DESCRIPTION:END -->
