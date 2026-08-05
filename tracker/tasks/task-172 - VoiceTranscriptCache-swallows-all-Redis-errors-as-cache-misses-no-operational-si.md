---
id: TASK-172
title: >-
  VoiceTranscriptCache swallows all Redis errors as cache misses (no operational
  signal)
status: To Do
assignee: []
created_date: '2026-06-24 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:common-types'
  - 'area:redis'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 172000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`VoiceTranscriptCache` swallows all Redis errors as cache misses (no operational signal)

**Why:** `VoiceTranscriptCache.store`/`get` (`packages/common-types/src/services/VoiceTranscriptCache.ts`) catch every Redis error and return `undefined`/`null`, which callers treat identically to a miss — so a Redis outage is invisible until users notice stale behaviour. The graceful-degradation shape is correct; the observability is the gap (there's `error`-level logging but nothing that alerts). Reviewer flagged as "no action required, just noting." **Fix shape (if promoted)**: emit a distinct counter/metric on the catch path (cache-error vs. cache-miss) so an outage is dashboard-visible, OR raise to a rate-limited alertable log. **Promote when**: alerting/metrics infra lands for cache layers, OR a Redis outage goes undiagnosed because it read as cold cache. Surfaced 2026-06-24 by PR #1324 release review (round 2).
<!-- SECTION:DESCRIPTION:END -->
