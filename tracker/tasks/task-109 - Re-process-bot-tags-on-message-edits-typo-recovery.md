---
id: TASK-109
title: Re-process bot tags on message edits (typo recovery)
status: To Do
assignee: []
created_date: '2026-05-17 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 109000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Re-process bot tags on message edits (typo recovery)

**Why:** If a user mistypes a bot's name in @-tagging and then edits to fix it, the bot doesn't notice — Discord.js `messageUpdate` events are ignored today. Subscribe in bot-client; if the edit changed which bot tags resolve, trigger the original processing path. **Edge cases**: idempotency on unchanged tag-set; no duplicate responses; sensible edit-window limit (Discord allows editing indefinitely but processing a 6-hour-old edit is weird). **Promote when**: any user complains about typo'd bot tags being lost (low frequency expected), OR when next touching the message-handling routing layer. **Start**: `services/bot-client/src/handlers/MessageHandler.ts` (routing) + add `messageUpdate` listener in `services/bot-client/src/index.ts`. Surfaced 2026-05-17 in personal notes. Deferred 2026-05-19.
<!-- SECTION:DESCRIPTION:END -->
