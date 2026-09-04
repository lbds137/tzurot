---
id: TASK-64
title: Single-flight dedup for HttpPersonalityLoader concurrent misses
status: To Do
assignee: []
created_date: '2026-06-04 00:00'
updated_date: '2026-09-04 20:03'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 64000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Single-flight dedup for `HttpPersonalityLoader` concurrent misses

**Why:** Concurrent cold-cache probes for the same `(userId, nameOrId)` each pay a gateway hop until the first response lands (thundering-herd-after-invalidation shape). Tolerable at Discord message rates. **Fix shape**: pending-promise map keyed by cache key, deleted in `finally`. **Promote when**: gateway logs show duplicate concurrent `/internal/personality/load` bursts for identical keys, or routing-read latency p95 spikes after invalidation events. Surfaced by PR #1156 claude-review. Deferred 2026-06-04.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:03
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-92 (Idea Scale gated watches — threshold inventory for the single instance ceiling); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-64 finds it.
---
<!-- COMMENTS:END -->
