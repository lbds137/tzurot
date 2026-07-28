---
id: TASK-100
title: DiscordChannelFetcher.convertMessage cognitive-complexity follow-up extraction
status: To Do
assignee: []
created_date: '2026-05-16 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: low
ordinal: 100000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`DiscordChannelFetcher.convertMessage` cognitive-complexity follow-up extraction

**Why:** The bot-footer strip added in PR #1035 pushed `convertMessage` over `sonarjs/cognitive-complexity` (suppressed alongside the existing `complexity` suppression — two suppressors on one function is a yellow flag the reviewer surfaced in rounds 4–5). The function does legitimate message-type-conversion branching (role detection, content building, attachment handling, reference resolution, forwarded-message extraction, footer stripping), so the suppression is justified, but extracting one of the sub-concerns into a helper would let the rule re-engage. **Fix shape**: candidate extractions — pull the attachment-handling block, the forwarded-message metadata builder, OR the reference-resolution path into a private method. ~30 LOC + light test rework. **Promote when**: next non-trivial `DiscordChannelFetcher` touch (opportunistic) — the reviewer explicitly framed this as "follow-up extraction in a future `DiscordChannelFetcher` touch." Surfaced 2026-05-16 PR #1035.
<!-- SECTION:DESCRIPTION:END -->
