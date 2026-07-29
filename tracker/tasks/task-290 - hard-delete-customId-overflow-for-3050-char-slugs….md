---
id: TASK-290
title: hard-delete customId overflow for 30-50-char slugs
status: Done
assignee: []
created_date: '2026-07-17 00:00'
updated_date: '2026-07-29 12:05'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 290000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-17 (#1697 r1, pre-existing class) — hard-delete customId overflow for 30–50-char slugs: `history::destructive::…::{slug}|{channelId}` fits ≤29-char slugs in Discord's 100-char customId limit, but `SLUG_MAX_LENGTH` is 50 — a long-slugged character makes `buildDestructiveWarning` throw at `setCustomId`. Pre-dates #1697 (the invoker-segment design that worsened it was reverted same-PR). **Fix shape**: move entityId to server-side state keyed by a short token (the memory/purge `issuePurgeToken` handshake is the in-repo precedent). **Promote when**: a long-slug hard-delete report, or PR-1b/PR-3's server-side-state work touches the flow.

**Why:** The failure is a synchronous throw, not a degraded reply — invisible until someone hits it.
<!-- SECTION:DESCRIPTION:END -->
