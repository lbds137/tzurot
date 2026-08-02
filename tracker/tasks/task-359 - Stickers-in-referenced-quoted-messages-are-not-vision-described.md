---
id: TASK-359
title: Stickers in referenced/quoted messages are not vision-described
status: Done
assignee: []
created_date: '2026-07-30 15:50'
updated_date: '2026-08-02 00:04'
labels:
  - 'size:M'
dependencies: []
priority: medium
ordinal: 359000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Why:** `extractStickerImages` is wired only into `MessageContentBuilder.ts`
(the TRIGGERING message). The referenced-message path — `MessageFormatter.ts`
and `SnapshotFormatter.ts`, which build the stored `referencedMessages` shape
later hydrated into RAG history — still renders stickers name-only. So a
character replying to a message that CONTAINS a sticker sees the sticker's name
but not its content, while the same sticker sent directly is described.

Conscious scope cut for #1872 (PR-1 of doc-55), not an oversight: those two
formatters build a persisted shape and would widen the diff into the history
hydration path, which deserves its own review. Surfaced 2026-07-30 by #1872
review.

**Fix shape**: call `extractStickerImages` in `MessageFormatter`/
`SnapshotFormatter` alongside their existing `extractEmbedImages` calls (the
pattern is identical — both already convert embeds to AttachmentMetadata
there). Verify the descriptions survive the hydration round-trip, and check
whether the `[Stickers: …]` line is already present in that shape so the two
don't double-render.

**Promote when**: doc-55's PR-2 (durable snowflake table) lands — with
descriptions cached permanently, describing a referenced sticker is nearly free
(a cache hit rather than a new vision call), which removes the main reason to
have scoped it out.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
SHARPENED 2026-07-30 by #1872 round-5 review — the original filing understated
this. Two distinct gaps, and the first is older and worse:

1. `SnapshotFormatter.ts` (the forwarded-snapshot referenced path) has ZERO
   sticker awareness — not even the name-only `[Stickers: …]` line. It builds
   `ReferencedMessage.content` from `snapshot.content` alone and its attachments
   from `extractAttachments` + `extractEmbedImages` only. So replying to a
   sticker-only forwarded message carries NO sticker information into context at
   all. This is a **#1868 gap**, not a vision gap — it predates the sticker
   vision work entirely.
   (`MessageFormatter.ts` DOES have it: `withStickerAndPollDescriptions` at
   :47/:57. Only the snapshot path was missed.)
2. Neither formatter calls `extractStickerImages`, so referenced stickers are
   not vision-described either — the original filing's point.

Process note worth keeping: `MessageContentBuilder.ts`'s file header carries an
explicit cross-reference — "@see SnapshotFormatter … If adding features here,
consider if SnapshotFormatter needs the same updates." #1872 modified that exact
file and did not follow it. The comment did its job; the reader didn't.

Fix shape unchanged for (2); for (1) add `withStickerAndPollDescriptions` to
SnapshotFormatter's content assembly, matching MessageFormatter.
<!-- SECTION:NOTES:END -->
