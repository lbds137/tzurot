---
id: TASK-360
title: Animated stickers are described from a single frame
status: To Do
assignee: []
created_date: '2026-07-30 15:51'
updated_date: '2026-07-30 17:42'
labels:
  - 'size:M'
dependencies: []
priority: low
ordinal: 360000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Why:** GIF and APNG stickers are handed to the vision pipeline as a single
image, so the model describes one frame. For a sticker whose meaning lives in
the MOTION (a character running away, a reaction building over frames) the
description can miss the point or, worse, describe a mid-animation pose as if it
were the whole gesture. Accepted limitation at ship (doc-55 names it); filed so
it is recorded rather than folklore. Surfaced 2026-07-30 with #1872.

**Fix shape**: no cheap one. Options if it ever matters — sample N frames and
describe the montage (multiplies token cost per asset, though still once per
sticker ever thanks to the snowflake cache), or detect animation and add a
"(animated)" hint to the prompt so the model knows it is seeing one frame of
several.

**Promote when**: a described animated sticker is observed reading wrong in a
real conversation — the owner or a user notices a character misreading a GIF
sticker's gesture. Until then the single frame is usually the sticker's
recognizable pose anyway.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
MECHANISM identified 2026-07-30 (#1872 round-7 review): the single-frame
behaviour is not a vision-model limitation — it is ours. `attachmentFetch.ts`
calls `sharp(buffer)` WITHOUT `{ animated: true }`, and sharp reads only the
first frame in that mode, so the animation is discarded before the model ever
sees it. That also means this applies identically to ordinary animated image
attachments, not just stickers.

Makes the fix shape concrete: `sharp(buffer, { animated: true })` preserves
frames, but the resize path and the data-URL size cap both need re-checking
before flipping it (an animated GIF materialised at full frame count can be
far larger than the single-frame equivalent, and the aggregate-payload guard
is sized for stills).
<!-- SECTION:NOTES:END -->
