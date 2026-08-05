---
id: TASK-356
title: Refresh sticker/poll descriptions when a message is edited
status: To Do
assignee: []
created_date: '2026-07-30 04:47'
updated_date: '2026-08-04 13:56'
labels:
  - 'size:S'
  - 'area:bot-client'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 356000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Sticker/poll descriptions are rendered into the message content at fetch/persist time (services/bot-client/src/utils/stickerPollDescriptions.ts, shipped in #1868). The edit path (ConversationSyncService content updates) re-syncs message text from the Discord snapshot, so a persisted row for a sticker/poll message could keep a stale description — and a row persisted BEFORE #1868 shipped keeps no description at all until something rewrites it.
Fix shape: confirm whether the sync diff's content comparison sees the rendered description (it compares against the Discord snapshot text, which does NOT include the bracket lines) — if the two forms differ, the diff may either no-op forever or thrash. Decide: render descriptions in the sync path too, or exclude the bracket lines from the comparison.
Promote when: a poll question is edited and the character quotes the old one, OR the sync diff shows repeated no-op churn on sticker/poll rows. Surfaced 2026-07-30 by PR #1868 round-5 review (explicitly flagged out of scope).
<!-- SECTION:DESCRIPTION:END -->
