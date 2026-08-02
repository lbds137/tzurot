---
id: TASK-398
title: Heal-on-read re-describes history stickers with no stickerVisionEnabled gate
status: To Do
assignee: []
created_date: '2026-08-02 00:52'
labels:
  - 'size:S'
  - 'area:ai-worker'
dependencies: []
priority: low
ordinal: 398000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Found while verifying an exhaustiveness claim during #1895 review (round 3).** The reviewer flagged that the new `stickerVisionGate` module doc read as a claim that only two points need the gate; checking it properly turned up a third path that genuinely has none.

**The path**: `ragVisionAuth.enrichRagHistory` -> `enrichConversationHistory(context.rawConversationHistory, ...)` -> `processAttachments`. This is heal-on-read over attachments already stored in CONVERSATION HISTORY, and no `stickerVisionEnabled` check applies anywhere along it.

**Why the other vision callers are fine and this one is not.** `ConversationInputProcessor`, `DependencyStep` and `extendedContextVisionProcessor` all read lists that `DownloadAttachmentsStep` already filtered, so they inherit that gate. `processAttachmentsParallel` got its own gate in #1895. The history path reads persisted rows instead, which were written when the switch may have been ON, and re-describes them when a description is missing.

**Why it was NOT just gated in #1895, and why this needs a decision rather than a patch.** The spend here is not the same shape as the others. Gates 1 and 2 stop us paying to describe a sticker that has just arrived. This path re-derives a description the system already paid for once and then lost (cache expiry, an older row, a failed write). Gating it means an admin flipping the switch off also degrades EXISTING history — stickers that were described and rendered fine yesterday start coming back bare. That may be exactly what an operator wants from a kill switch, or it may be a surprising retroactive change to conversations already had. It is a product call.

**Options**: (a) gate it, so off means off everywhere and history degrades; (b) leave it ungated on the grounds that heal-on-read completes work already authorised, and say so in the module doc; (c) gate it separately from the arrival switch, so the two can differ.

**Acceptance**: whichever is chosen, the `stickerVisionGate` module doc stops listing this as a known ungated path and states the decision instead.

**Promote when**: sticker vision is actually switched off in prod and the spend does not drop as expected — that is the observation that turns this from tidy-up into a real gap. Until then the switch has never been flipped, so the path has never mattered.
<!-- SECTION:DESCRIPTION:END -->
