---
id: TASK-379
title: bot-client builds an enriched references array that only feeds two log counts
status: To Do
assignee: []
created_date: '2026-07-31 16:15'
labels:
  - 'size:M'
dependencies: []
priority: medium
ordinal: 379000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Why:** `ReferenceFormatter.format()` returns `references` (enriched) alongside `rawReferences` (the wire payload). The enriched array reaches exactly two places — a count at `MessageContextBuilder.ts:399` and a count+boolean at `gatewayServiceCalls.ts:245`. It never reaches the envelope (`rawEnvelope.ts` carries `rawReferencedMessages` only), never the DB (`PersonalityChatManager` calls `saveUserMessage` without the arg, so `ConversationPersistence`'s `if (referencedMessages && ...)` guard never opens), and never the model.

Building it is not free: `appendRegular` calls `messageFormatter.formatMessageWithRaw`, whose `appendTranscriptsWithRetriever` does Redis + DB transcript lookups for every reference on every message with references — work ai-worker then re-runs itself against its own history (`enrichRawReferences`, by design).

#1882 removed the last shape difference on the deduped branch, so `references` and `rawReferences` are now identical for deduped and forwarded entries, and differ only by the appended transcript on the regular one.

**Fix shape:** re-verify no consumer beyond the two log lines (grep `referencedMessages` in bot-client), then delete the enriched array and the bot-side transcript append; keep `rawReferences`. Touches `ReferenceFormatter`, `MessageFormatter`, `MessageReferenceExtractor`, `ReferenceExtractor`, `MessageContextBuilder`, `gatewayServiceCalls`. Replace the two log fields with counts off `rawReferences`.

**Watch for:** the transcript retriever may be warming a cache something else reads. Confirm before deleting.

Surfaced 2026-07-31 (#1882, TASK-365 PR-2).
<!-- SECTION:DESCRIPTION:END -->
