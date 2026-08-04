---
id: TASK-424
title: >-
  Extended-context voice-transcript DB lookups fail repeatedly for the same
  messages
status: To Do
assignee: []
created_date: '2026-08-04 02:51'
labels:
  - 'size:S'
dependencies: []
priority: low
ordinal: 424000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod sweep 2026-08-04 — DiscordChannelFetcher logs Using bot reply fallback for voice transcript (DB lookup failed) for the SAME 4 messageIds on every extended-context fetch of one channel (80 lines/6h, 4 per request). The fallback works (bot reply text is used) but the lookup re-fails forever: those rows never heal, and each request pays 4 doomed DB lookups plus log spam.

Fix shape: investigate why the transcript rows are absent (pre-retention messages? never persisted?), then either write-back the fallback result so the next fetch hits, or negative-cache the known-absent ids for the session.

Acceptance: repeated fetches of the same channel do not re-log the same messageIds; lookup volume drops to one attempt per absent row per process lifetime.
<!-- SECTION:DESCRIPTION:END -->
