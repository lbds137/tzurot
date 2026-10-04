---
id: TASK-1163
title: >-
  Verify whether /history clear and purge affect extended context
  (Discord-fetched channel history)
status: To Do
assignee: []
created_date: '2026-10-04 16:46'
labels:
  - 'area:bot-client'
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1155000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a user asked how /history clear works (does it remove only your messages so the bot still sees everyone else?). Owner 2026-10-04: "for channel clearing, it should check whether the user has manage messages permission. but does this even have impact on extended context. we need to verify because I am not sure". Two parts. (1) The Manage Messages gate: ALREADY SHIPPED for the channel-wide scope - /history purge scope everyone checks interaction.memberPermissions for ManageMessages (services/bot-client/src/commands/history/purge.ts:78-106, re-checked on submit; smoke item 2 passed 2026-09-13). Whole-channel multi-character reset is TASK-526. Nothing to build for the gate. (2) The extended-context question is OPEN. CODE-READING SUGGESTS (not runtime-verified): /history clear writes a soft-reset epoch per (user, character, persona) (UserPersonaHistoryConfig.lastContextReset, services/api-gateway/src/routes/user/history.ts:114-127), it deletes no rows and does not touch Discord messages. That epoch IS passed to the extended-context fetch (MessageContextBuilder.ts:317 -> DiscordChannelFetcher.ts:242 computeHistoryCutoff(maxAge, contextEpoch)), so Discord-fetched channel messages older than the epoch are cut for that persona+character turns, and the cut is by TIME, so it hides EVERY author messages before the epoch, not only the clearer own. /history purge goes through ConversationRetentionService.clearHistory (history.ts:~321) which deletes DB rows; no epoch write was found on that path, so a purge probably does NOT remove Discord-fetched extended context (the messages are still in the channel). Also: the epoch is per user persona + character, not per channel, so another user in the same channel still sees the older messages. Related: TASK-312 (/history browse), TASK-526.
What: confirm by a runtime probe in dev (clear, then inspect the next turn prompt via /inspect; repeat for purge) and by reading computeHistoryCutoff; then record the result in the user-facing help text (docs/commands.md) and decide whether purge should also write an epoch.
Acceptance: a written verdict for clear and for purge (affects extended context yes/no, and for whom), with the /inspect evidence, recorded on this task; a follow-up filed if purge should set the epoch.
<!-- SECTION:DESCRIPTION:END -->
