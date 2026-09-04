---
id: TASK-84
title: Per-instance evictionLock serializes prepare() across all slugs
status: To Do
assignee: []
created_date: '2026-05-04 00:00'
updated_date: '2026-09-04 20:04'
labels:
  - 'area:voice'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 84000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Per-instance `evictionLock` serializes `prepare()` across all slugs

**Why:** `ElevenLabsTtsProvider` + `MistralTtsProvider` use a per-instance promise-chain mutex for `prepare()` — correct for race protection but ALL slugs serialize on the same lock. If slug A's clone hangs, slug B's `prepare()` waits the full timeout. Worst-case latency `(N_concurrent_slow_prepares × timeout)`. **Fix**: per-slug lock map. ~30 LOC across both providers. **Promote when**: simultaneous persona switches with cold caches AND latency complaints surface, OR opportunistic when next touching either provider. Surfaced 2026-05-04 PR #967. Deferred 2026-05-07.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:04
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-92 (Idea Scale gated watches — threshold inventory for the single instance ceiling); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-84 finds it.
---
<!-- COMMENTS:END -->
