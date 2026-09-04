---
id: TASK-102
title: MessageContextBuilder.cachedBotSuffix promote pre-login note to hard invariant
status: To Do
assignee: []
created_date: '2026-05-16 00:00'
updated_date: '2026-09-04 19:56'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:56
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-89 (Idea Silent degradation deferrals — the triggering change per member); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-102 finds it.
---
<!-- COMMENTS:END -->
