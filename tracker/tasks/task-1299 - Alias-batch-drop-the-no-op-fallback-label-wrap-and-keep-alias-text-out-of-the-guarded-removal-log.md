---
id: TASK-1299
title: >-
  Alias batch: drop the no-op fallback label wrap and keep alias text out of the
  guarded removal log
status: To Do
assignee: []
created_date: '2026-10-26T18:44:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1285000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2666 review round 3, merged with these open (owner ruling 2026-10-26). (1) services/bot-client/src/commands/character/aliasBatch.ts handleAliasBatchPick wraps fallbackAliasLabel(id) in truncateForSelect(..., { stripNewlines: true }), but fallbackAliasLabel already does both, so the wrap is a no-op and the test 'uses a truncated and newline-stripped fallbackAliasLabel ... (C13)' in aliasBatch.test.ts passes with or without it. (2) services/bot-client/src/commands/character/aliasBatchConfirm.ts runSingleAliasRemoval logs err: error in the catch that guards a client-contract change; today the client never rejects (packages/clients/src/clients/transport.ts callGateway returns a status-0 envelope), but a future rejection whose message carries the request URL would put the user's alias text in logs. What: drop the wrap and rename the test to what it pins; in the catch, log the error class/kind only or route the message through the logContentPreview helpers, with a test pinning no alias text in the logged error. Acceptance: no no-op wrap; the test title matches its assertion; the guarded log cannot carry alias text.
<!-- SECTION:DESCRIPTION:END -->
