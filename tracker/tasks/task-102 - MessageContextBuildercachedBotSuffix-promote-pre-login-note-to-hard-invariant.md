---
id: TASK-102
title: MessageContextBuilder.cachedBotSuffix promote pre-login note to hard invariant
status: To Do
assignee: []
created_date: '2026-05-16 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 102000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`MessageContextBuilder.cachedBotSuffix` promote pre-login note to hard invariant

**Why:** The `cachedBotSuffix` field documents that it freezes at `''` if `fetchExtendedContext` runs before the Discord client logs in. Today this can't happen — extended context is driven by message events that only fire post-`ready` — but the safety is implicit. **Fix shape**: when an explicit `Client.isReady()` (or equivalent gateway-ready) assertion lands at the entry point of the bot-client message pipeline, this method becomes a candidate to remove the `cachedBotSuffix === null` guard and reach for `client.user.tag` directly with a non-null assertion, turning the post-login assumption into an enforced invariant. ~5 LOC. **Promote when**: an explicit gateway-ready assertion is added to the bot-client startup or message-handler entry point. Surfaced 2026-05-16 PR #1035 round 5.
<!-- SECTION:DESCRIPTION:END -->
