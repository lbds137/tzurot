---
id: TASK-1332
title: 'Audit batch: bot-client batch and modal error paths'
status: Done
assignee: []
created_date: '2026-11-01T11:33:00Z'
updated_date: '2026-11-01T22:30:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1315000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: post-merge audit, verified by reading. Batch of small items. (1) services/bot-client/src/commands/deny/detailEdit.ts handleEditModal: a rejected edit wipes the embed and buttons while the comment says the user can re-edit; keep the view and report the error beside it. Separate from TASK-1327. (2) services/bot-client/src/commands/memory/interactionHandlers.ts: a throw in refreshFactsList after a successful forget reaches the generic error, implying the forget failed; use the afterForget notice. (3) services/bot-client/src/commands/character/aliasBatch.ts entry and pick handlers have no catch after ack; duplicate 92-char prefixes make buildBrowseSelectMenu throw. (4) services/bot-client/src/commands/character/aliasBrowseView.ts formatAliasSelectValue slices UTF-16, which can split an emoji; Discord handling of a lone surrogate is unprobed. (5) services/bot-client/src/commands/deny/browseBatch.ts comment says 25 options; ITEMS_PER_PAGE is 10. (6) services/bot-client/src/services/character/sharedNsfwGate.test.ts: the runNsfwGate test covers three scenarios in one it block; split them (claude-review on PR 2690).
Acceptance: each fixed with a test, or dispositioned with a reason.
<!-- SECTION:DESCRIPTION:END -->
