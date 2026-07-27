---
id: TASK-206
title: 'Channel-wide bot-history delete'
status: To Do
assignee: []
created_date: '2026-07-05 00:00'
labels:
  - 'area:jobs'
dependencies: []
ordinal: 206000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Channel-wide bot-history delete — **BUILD-READY (owner decision 2026-07-05)**

**Why:** Permission: **Manage Messages in that channel, or bot owner**. Surface: `scope` option on `/history purge` (`own` = default/current behavior; `everyone` = permission-gated channel-wide). Mechanics already exist: `ConversationRetentionService.clearHistory(channelId, personalityId)` with personaId omitted does the channel-wide delete — the route needs a scope param + permission check, the command needs the option + a destructive confirm whose copy states the FULL scope ("ALL users' conversation history with X in this channel"). Bot-side history only; memories untouched (same as personal delete). **Promote when**: next /history touch, or Opus build-queue pull.
<!-- SECTION:DESCRIPTION:END -->
