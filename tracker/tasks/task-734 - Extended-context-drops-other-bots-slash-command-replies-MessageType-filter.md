---
id: TASK-734
title: Extended context drops other bots slash-command replies (MessageType filter)
status: To Do
assignee: []
created_date: '2026-08-22 21:17'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: high
ordinal: 734000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner prod report 2026-08-22 (talk-to-ai channel) — an app-bot speaking via /command replies is invisible to characters: isUserContentMessage (services/bot-client/src/utils/messageTypeUtils.ts:41) passes only MessageType.Default/Reply/forwards, so ChatInputCommand replies never enter extended context. Plain bot messages DO get in (verified in the reported prompt: the same bot appears via ordinary messages). Runtime evidence: the reported 187KB prod prompt has zero entries from the bot on the report day while same-minute human messages are present, and zero embed text.
Fix shape: widen isUserContentMessage to accept MessageType.ChatInputCommand (+ ContextMenuCommand); downstream already handles content (hasMessageContent counts embeds, messageMetadataBuilder renders embedsXml; our-bot exclusions key on botUserId and are unaffected). BotMessageFilter (triggering) deliberately untouched — separate, riskier call.
Acceptance: an app-bot /command reply (text and embed-only) appears in extended context; our own utility-message exclusions unchanged; tests at the type-filter and through the fetcher.
<!-- SECTION:DESCRIPTION:END -->
