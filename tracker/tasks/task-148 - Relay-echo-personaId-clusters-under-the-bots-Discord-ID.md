---
id: TASK-148
title: Relay-echo personaId clusters under the bot's Discord ID
status: To Do
assignee: []
created_date: '2026-06-16 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 148000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Relay-echo `personaId` clusters under the bot's Discord ID

**Why:** In `DiscordChannelFetcher.convertMessage`, a chime-in/slash relay echo is now correctly `role=user` (PR #1236 Bug B), but `personaId` is `INTERNAL_DISCORD_ID_PREFIX + msg.author.id` where `msg.author.id` is the **bot's** id (it authored the echo), not the real user's. So all relay echoes in a window share one `personaId`. **Not harmful today**: `personaName` carries the correct user name from the `**Name:** ` prefix (attribution is visible), and `isRealUser` (`msg.author.bot !== true`) already excludes echoes from participant/persona collection, so it doesn't pollute participants or compound. The real user's Discord id is genuinely unrecoverable from a bot-authored message. **Fix shape**: thread the original user's id onto the relay echo at send time (e.g. persist it, or store it in the webhook/relay registry) so `convertMessage` can attribute `personaId` precisely. **Promote when**: a `personaId`-keyed feature needs relay echoes attributed to the real user — e.g. `/inspect` wanting to show the echo as the original user, or per-user dedup/analytics over relay echoes. Surfaced 2026-06-16 by PR #1236 claude-review (observation 2, non-blocking). Deferred 2026-06-16.
<!-- SECTION:DESCRIPTION:END -->
