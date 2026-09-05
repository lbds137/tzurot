---
id: TASK-894
title: >-
  history undo reports success with nothing to restore after another user purged
  the channel
status: To Do
assignee: []
created_date: '2026-09-05 04:14'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 892000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: /history purge scope:everyone (#2339) hard-deletes every user rows for a character in a channel, but the context-epoch row it resets is only the invoking moderator own (userPersonaHistoryConfig is keyed by user + personality + persona with no channel dimension: grep -n -A12 "model UserPersonaHistoryConfig" prisma/schema.prisma). A user whose messages were purged and who had earlier run /history clear still carries lastContextReset, so their later /history undo swaps the epochs back and answers "Previous context restored" although every underlying message is gone (the undo handler in services/api-gateway/src/routes/user/history.ts returns restoredEpoch and never counts what became visible). Misleading success text, not data damage. Surfaced by claude-review round 1 on #2339.

Fix shape: on the undo side, not the purge side. Bulk-resetting every user epoch on a channel-wide purge would be wrong because the epoch row spans every channel that user shares with the character. Instead have the undo route count the rows that fall back into the visible window after the epoch swap (a bounded count over conversation history for that user + personality newer than restoredEpoch) and return it; bot-client renders "Restored N messages" or "Nothing to restore: the history from before your last clear is gone" on zero. Same message-count contract the purge route already returns (deletedCount).

Acceptance: undo after a purge that emptied the window says nothing was restored; undo with surviving history reports the count; both pinned at the route (seam: the count query) and at the command (copy).
<!-- SECTION:DESCRIPTION:END -->
