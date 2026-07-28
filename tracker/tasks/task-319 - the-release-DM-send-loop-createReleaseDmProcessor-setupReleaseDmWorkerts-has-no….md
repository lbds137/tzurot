---
id: TASK-319
title: Short-circuit release-DM batches on bot_level (20026) failures
status: To Do
assignee: []
created_date: '2026-07-23 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'area:jobs'
  - 'size:S'
dependencies: []
priority: low
ordinal: 319000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-23 (#1774 review, non-blocking) — the release-DM send loop (`createReleaseDmProcessor`, `setupReleaseDmWorker.ts`) has no fast-path for a `bot_level` (Discord 20026) failure: since 20026 means the BOT is quarantined bot-wide, once one send returns `bot_level` every remaining recipient in the batch — and every later batch of the same blast — fails identically, yet the loop still burns the full `DM_SEND_DELAY_MS` (1s) per recipient and reports each individually. A large blast during a quarantine becomes a multi-minute-to-hour no-op instead of failing fast. **Fix shape**: short-circuit the batch/blast on the first `bot_level` outcome (mark remaining recipients `failed_bot_level` without sleeping, or abort the blast). **Promote when**: a real prod quarantine event happens (the first time this actually wastes wall-clock at scale).

**Why:** Real but rare efficiency issue — the waste is time, not correctness, on an infrequent event; out of #1774's classification/accounting scope.
<!-- SECTION:DESCRIPTION:END -->
