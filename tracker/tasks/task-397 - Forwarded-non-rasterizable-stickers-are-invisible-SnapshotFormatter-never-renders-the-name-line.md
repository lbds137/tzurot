---
id: TASK-397
title: >-
  Forwarded non-rasterizable stickers are invisible: SnapshotFormatter never
  renders the name line
status: To Do
assignee: []
created_date: '2026-08-02 00:39'
labels:
  - 'size:S'
  - 'area:bot-client'
dependencies: []
priority: medium
ordinal: 397000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Raised by #1895 review (round 1), and it corrects a claim in that PR body.**

I wrote that `SnapshotFormatter` "was missing the image half only." That is wrong. It never calls `withStickerAndPollDescriptions` at all — before or after #1895 — so it renders no sticker NAME either.

**Consequence, for the non-rasterizable subset only.** A Lottie sticker has no raster form, so `stickersToAttachments` correctly filters it out and #1895 gives it no description. In `MessageFormatter` that is fine: both its branches call `withStickerAndPollDescriptions`, so the sticker still gets a `[Stickers: name]` label. In `SnapshotFormatter` — the path `ReferenceFormatter.appendForwardedSnapshots` uses for every NON-deduplicated forwarded message, i.e. the common case — there is no such call. So a forwarded Lottie sticker produces neither name nor description: `content` stays whatever `snapshot.content` was (typically empty for a sticker-only message) and `attachments` stays undefined. **The sticker is entirely invisible to the model.**

Pre-existing, not introduced by #1895 — but #1895 is what makes the asymmetry sharp, because now every OTHER sticker shape in that path is described.

**Second site, same family (same review, minor):** `forwardedMessageUtils.extractAllForwardedContent` no-snapshot fallback (used by `hasForwardedContent` / `hasForwardedVoiceAttachment`) also ignores stickers. That one only feeds a boolean has-meaningful-content gate on the rare path where Discord did not populate snapshots — no vision spend, but the same blind spot.

**Fix shape**: call `withStickerAndPollDescriptions` (or the sticker half of it) in `SnapshotFormatter.formatSnapshot` so the name line is present regardless of rasterizability, matching what `MessageFormatter` already does. Check the forwarded-dedup path does not then render the names twice.

**Why not ridden into #1895**: that PR is about vision descriptions on three attachment paths; this is text rendering on a fourth, and it touches the deduped-vs-not interaction that TASK-365 is actively consolidating. Worth its own review surface.

**Promote when**: picked up alongside TASK-365 render-path consolidation, or if a forwarded Lottie sticker is observed reaching a character as nothing at all.
<!-- SECTION:DESCRIPTION:END -->
