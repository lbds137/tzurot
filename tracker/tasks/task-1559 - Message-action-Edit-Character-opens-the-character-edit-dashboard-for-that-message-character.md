---
id: TASK-1559
title: >-
  Message action: Edit Character (opens the /character edit dashboard for that
  message character)
status: To Do
assignee: []
created_date: '2026-11-26T11:47:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1553000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila (11-26) wants to edit a character straight from its message; wanted in beta.252.

What: a message context-menu command "Edit Character" resolves the personality that sent the clicked message (same gateway message lookup as the Chime In action, ConversationHistory by discord message id, not the 7-day diagnostic log) and opens the same dashboard /character edit opens. Extract the body of handleEdit after fetchCharacter (commands/character/edit.ts:34) into a helper both callers use. Same canEdit permission check: a character the user cannot edit gets the existing ephemeral refusal.

Acceptance: works on any message of a character the user owns (bot owner: any); refusal on others; ephemeral error on non-character messages; dashboard buttons route as from the slash command (session stored the same way).
<!-- SECTION:DESCRIPTION:END -->
