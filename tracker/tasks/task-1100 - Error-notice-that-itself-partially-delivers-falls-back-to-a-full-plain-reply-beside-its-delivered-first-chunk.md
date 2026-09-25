---
id: TASK-1100
title: >-
  Error notice that itself partially delivers falls back to a full plain reply
  beside its delivered first chunk
status: To Do
assignee: []
created_date: '2026-09-25 13:13'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1093000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review round 2 on PR #2530 (low, informational; a merits call, not an origin-scoped dismissal). SlotDeliveryService.sendErrorViaWebhook and MessageHandler.sendSlashErrorResponse send the error NOTICE through responseSender.sendResponse, which since #2530 wraps any mid-stream failure into PartialDeliveryError. Both catch blocks treat that like a total failure: the notice chunk ids stay null, the ids of the notice chunk that DID land are discarded, and the plain-reply fallback (message.reply / channel.send) posts the FULL unchunked error text, which the user sees beside the already-delivered first chunk. Rare: error notices are usually one chunk, so this needs a notice long enough to split AND a failure on its second chunk. The double-send shape predates #2530 (the fallback always replied the full text on any notice-send failure); #2530 made the partial case distinguishable, which is what makes a fix possible now.
Fix shape: in both notice-send catches, branch on err instanceof PartialDeliveryError: keep the delivered notice ids (feed them to the turn composer as the notice ids, grep resolveErrorPathTurn in partialDelivery.ts) and either skip the plain-reply fallback or reply only the undelivered remainder. Pin with one wiring test per call site through the real DiscordResponseSender, mirroring the partial wiring tests #2530 added (grep "wraps a mid-stream" in DiscordResponseSender.test.ts for the mock shape).
Acceptance: a two-chunk error notice whose second chunk fails leaves exactly one visible notice chunk plus no full-text duplicate, and the persisted turn row carries the delivered notice id; a total notice-send failure still takes the plain-reply fallback.
<!-- SECTION:DESCRIPTION:END -->
