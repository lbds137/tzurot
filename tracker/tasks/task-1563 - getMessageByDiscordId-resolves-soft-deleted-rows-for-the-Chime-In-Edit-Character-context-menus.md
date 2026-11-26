---
id: TASK-1563
title: >-
  getMessageByDiscordId resolves soft-deleted rows for the Chime In / Edit
  Character context menus
status: To Do
assignee: []
created_date: '2026-11-26T20:26:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1557000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2819 review (nit 7). getMessageByDiscordId (packages/conversation-history/src/ConversationHistoryService.ts) has no deletedAt filter, so a context-menu action on a reply the user deleted from history still resolves it; Chime In on a deleted turn is surprising. Reply resolution and DM session recovery share the function, so the filter must be scoped (a parameter or a separate query) rather than global.

What: decide per caller whether soft-deleted rows should resolve; for the two context-menu callers, treat a soft-deleted row as not a character reply (the existing ephemeral refusal).

Acceptance: a test per context-menu action that a soft-deleted row is refused; reply resolution behaviour unchanged and pinned.
<!-- SECTION:DESCRIPTION:END -->
