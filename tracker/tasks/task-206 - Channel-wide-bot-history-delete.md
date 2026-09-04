---
id: TASK-206
title: Channel-wide bot-history delete
status: To Do
assignee: []
created_date: '2026-07-05 00:00'
updated_date: '2026-09-04 19:40'
labels:
  - 'area:jobs'
  - 'area:conversation-history'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 206000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Channel-wide bot-history delete — **BUILD-READY (owner decision 2026-07-05)**

**Why:** Permission: **Manage Messages in that channel, or bot owner**. Surface: `scope` option on `/history purge` (`own` = default/current behavior; `everyone` = permission-gated channel-wide). Mechanics already exist: `ConversationRetentionService.clearHistory(channelId, personalityId)` with personaId omitted does the channel-wide delete — the route needs a scope param + permission check, the command needs the option + a destructive confirm whose copy states the FULL scope ("ALL users' conversation history with X in this channel"). Bot-side history only; memories untouched (same as personal delete). **Promote when**: next /history touch, or Opus build-queue pull.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Not built — `purge.ts` has no `scope`/`everyone` option, no permission check for channel-wide delete; `clearHistory()` still only takes the 3-arg shape used for persona-scoped deletes. Owner already decided to build this; it's just not picked up yet. Evidence: `grep -n "scope\|everyone\|ManageMessages" services/bot-client/src/commands/history/purge.ts` → no hits; `grep -n "async clearHistory" packages/conversation-history/src/ConversationRetentionService.ts` → unchanged signature.
---

author: digest-pass
created: 2026-09-04 19:40
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): OWNER-DECIDED, UNBUILT (Shape 14). Carries a recorded owner decision; only implementation remains. Promoted to priority medium so it runs in one of the two decided-work drain batches rather than waiting on an opportunistic trigger that has not fired.
---
<!-- COMMENTS:END -->
