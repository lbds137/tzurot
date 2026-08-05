---
id: TASK-167
title: deleteVoice/clearVoices chain sequential external calls
status: To Do
assignee: []
created_date: '2026-06-24 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:jobs'
  - 'area:voice'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 167000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`deleteVoice`/`clearVoices` chain sequential external calls — can exceed the sync timeout cap

**Why:** The external-call-timeout contract (#1323) covers SINGLE-call routes (`setWalletKey`, `testWalletKey`, `listVoices`, `listShapes`). But `voices.ts` `deleteVoiceImpl` does fetch-then-delete (2 sequential provider calls × `EXTERNAL_AUDIO_API_CALL` 30s = up to 60s) and `clearVoicesImpl` loops N sequential `deleteVoiceAtProvider` calls (N × 30s) — both can exceed even `EXTERNAL_PROVIDER` (40s) / the manifest's 60s `timeoutMs` cap. They're a genuinely different shape than the single-call class: the type-doc says >60s sync work should be a BullMQ job with push-based delivery. **Fix shape**: parallelize delete's fetch+delete where safe, and/or move `clearVoices` to a BullMQ job. **Promote when**: a delete/clear-voices timeout is observed, or the voices-management UX is next touched. Surfaced 2026-06-24 by PR #1323 (external-call-timeout contract; deliberately scoped to single-call routes).
<!-- SECTION:DESCRIPTION:END -->
