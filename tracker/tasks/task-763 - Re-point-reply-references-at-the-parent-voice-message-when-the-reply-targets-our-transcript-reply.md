---
id: TASK-763
title: >-
  Re-point reply references at the parent voice message when the reply targets
  our transcript reply
status: To Do
assignee: []
created_date: '2026-08-24 15:19'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 763000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: replying to the transcript message the bot posts under a voice message produces a reference to the TRANSCRIPT message - author is the bot, content is the transcribed user speech - so the character sees the words of the user attributed to the bot, and the messageId-keyed chat-log dedup can never fire because the transcript message is deliberately excluded from model context (isContextExcludedBotMessage) while the SAME content rides the chat log as the voice message turn. Extended context already handles this correctly (exclusion + fallback map in DiscordChannelFetcher); only the reply-reference path lacks the recognizer. Surfaced by an owner question during the beta.207 smoke session; verified against ReplyReferenceStrategy.ts (no special-casing) and messageTypeFilters.ts (recognizer exists).

Fix shape: in the reply-reference path (ReplyReferenceStrategy.extract or the crawler seam that fetches the referenced message), when the resolved message satisfies isBotTranscriptReply, follow its own reference.messageId one hop to the parent voice message and emit THAT as the reference. The worker then re-derives the transcript from its DB tier as it already does for voice-message references, attribution is the user, and the dedup stub can anchor against the chat-log copy. Cap the hop at one (a transcript reply always references the voice message directly).

Acceptance: a reply to a bot transcript message renders a reference whose author is the voice-message sender with role user and whose content carries the transcript; a seam test pins the retarget; replies to non-transcript bot messages are unchanged.
<!-- SECTION:DESCRIPTION:END -->
