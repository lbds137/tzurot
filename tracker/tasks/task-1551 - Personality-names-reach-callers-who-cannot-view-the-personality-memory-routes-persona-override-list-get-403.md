---
id: TASK-1551
title: >-
  Personality names reach callers who cannot view the personality (memory
  routes, persona-override list, get 403)
status: To Do
assignee: []
created_date: '2026-11-25T19:16:00Z'
labels:
  - area:api-gateway
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1546000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2813 (TASK-1504) gated the config/model/tts/persona override routes behind requireVisiblePersonality. Its round-3 route classification found the remaining visibility-blind name sites under services/api-gateway/src/routes:

- user/memoryHelpers.ts getPersonalityById (L40-43) loads { id, name } with no visibility check; the name reaches responses as personalityName in memory stats (memory.ts:70) and the purge token (memoryBatch.ts:306).
- user/memoryModeHandlers.ts (L184-194, getPersonalityName L71-82) does an existence-only check, then puts the name in the response message (L205, L257).
- user/persona/override.ts handleListPersonaOverrides (L84-117) returns the caller-owned rows joined with slug/name/displayName, so a row set against a personality that has since gone private still shows its names. Decide whether a row holder may keep seeing the name; that is the same stale-row question the owner settled for DELETE (rows stay clearable).
- user/personality/get.ts checkUserAccess answers 403 for an invisible personality where the shared gate answers 404, so existence is distinguishable. Consolidate onto requireVisiblePersonality.

What: route each through requireVisiblePersonality (helpers.ts) or drop the name from the response; private non-owner tests per site.

Acceptance: no response under routes/user carries the name of a personality the caller cannot view, unless the caller holds a row for it and the list decision says that is allowed. Line numbers are as of cdf9d321e plus round 3.
<!-- SECTION:DESCRIPTION:END -->
