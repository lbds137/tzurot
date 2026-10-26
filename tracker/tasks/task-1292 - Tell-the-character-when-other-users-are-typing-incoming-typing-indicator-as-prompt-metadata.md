---
id: TASK-1292
title: >-
  Tell the character when other users are typing (incoming typing indicator as
  prompt metadata)
status: To Do
assignee: []
created_date: '2026-10-26 02:27'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1278000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner idea 2026-10-25: when users other than the bot are typing in the channel, pass that to the model as prompt metadata so the character knows someone is typing.

Premise (checked): bot-client subscribes to neither GuildMessageTyping nor DirectMessageTyping (intent list pinned in services/bot-client/src/utils/discordClientOptions.test.ts:14-19), so no typingStart events arrive today. doc-24 covers the bot's OWN outbound indicator, not this.

What: add the typing intents; keep a short-TTL per-channel record of recent typingStart events (Discord fires ~every 10s while typing, no stop event, so expiry is time-based); include "currently typing: <names>" in the context metadata at prompt-build time, excluding the bot and the requester.

Open design points: which context block carries it (sits beside the existing channel/participant metadata); whether a reply should ever wait briefly for a typist; per-replica state (Redis vs in-memory, multi-replica).

Acceptance: with a second user typing during a request, the prompt shows that user as typing; with nobody typing, nothing is added; stale entries expire.
<!-- SECTION:DESCRIPTION:END -->
