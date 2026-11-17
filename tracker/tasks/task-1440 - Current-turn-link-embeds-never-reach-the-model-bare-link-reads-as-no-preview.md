---
id: TASK-1440
title: Current-turn link embeds never reach the model (bare link reads as no preview)
status: To Do
assignee: []
created_date: '2026-11-17T20:09:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: high
ordinal: 1440000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 2026-11-17 prod, Emily (glm-5.3-flash) answered a bare x.com link with "it came through with no preview". Debug 8a10e095 (20:03:47Z): the current-turn render is the bare URL, no <embeds> block, zero mentions of the tweet text. Debug d1d17328 (20:04:32Z): the SAME message, now in history, carries the full embed (author, description, timestamp). So Discord had the unfurl within ~45 s; the current turn did not.

What (code-reading, not runtime-confirmed): MessageReferenceExtractor.extractReferencesWithReplacement waits EMBED_PROCESSING_DELAY (2500 ms, common-types constants/timing.ts:126) and refetches the trigger (MessageReferenceExtractor.ts:149-152), but the refetched message only feeds the reference crawl. MessageContextBuilder.ts:361 builds the trigger content with includeEmbeds: false, and the raw envelope (common-types types/schemas/rawEnvelope.ts) has no embed field: the worker re-derives the current turn from rawMessageContent only. ConversationPersistence.saveUserMessage persists embedsXml from the ORIGINAL message object, so a pre-unfurl trigger also persists without its embed. Open question: did the pre-envelope path render trigger embeds (regression from ebf4ec3a3) or was this always missing? Partial answer (git log -S, 11-17): the includeEmbeds: false exclusion dates from 9e0d14a51 (2026-01-05, buildMessageContent DRY refactor; it replaced an extractEmbedImages call that fed embed IMAGES only), five months before ebf4ec3a3 (2026-06-05), so ebf4ec3a3 did not introduce it; whether any pre-envelope path rendered trigger embed TEXT is still unchecked.

Acceptance: the current turn carries the trigger message embeds from the refetched message (same EmbedParser render the history path uses, DiscordChannelFetcher.ts:447); persistence uses the refetched message too; a seam test pins a trigger whose embeds arrive only on refetch; a prod or dev observation of a bare-link trigger rendering its embed on the first reply.
<!-- SECTION:DESCRIPTION:END -->
