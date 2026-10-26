---
id: TASK-1298
title: >-
  Alias DELETE 404 needs a code that separates alias-missing from
  character-not-visible
status: To Do
assignee: []
created_date: '2026-10-26T17:52:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1284000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the alias batch removal (services/bot-client/src/commands/character/aliasBatchConfirm.ts runSingleAliasRemoval) now reports every gateway 404 as a failed line, because the alias routes 404 an invisible character too (services/api-gateway/src/routes/user/personality/aliases.ts requireVisiblePersonality sends notFound('Personality')). The delete handler sends notFound('Alias') only after visibility passed, but both carry error code NOT_FOUND (services/api-gateway/src/utils/errorResponses.ts notFound), so the bot could only tell them apart by message wording. Effect: an alias deleted elsewhere between the batch's list fetch and its DELETE shows a red failure where already gone is the truth (a seconds-wide race). Owner ruling 2026-10-26 on PR 2666: leave the red failure, add a proper code. What: give the alias-missing 404 a distinct error code (or a structured resource field) in the gateway response and the clients envelope, then map it to already gone in runSingleAliasRemoval; contract test on the code. Acceptance: a 404 for a missing alias on a visible character reports already gone; a 404 for an invisible character still reports failed; no branching on message text.
<!-- SECTION:DESCRIPTION:END -->
