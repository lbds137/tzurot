---
id: TASK-42
title: >-
  handleListModelOverrides supportsVision enrichment: sequential await, not
  Promise.all
status: Done
assignee: []
created_date: '2026-07-01 00:00'
updated_date: '2026-07-30 00:36'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: low
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`handleListModelOverrides` supportsVision enrichment: sequential `await`, not `Promise.all`

**Why:** The override-list loop `await capabilities.supportsVision(model)` per emitted row sequentially (≤200 lookups under `?kind=all`); the sibling `user/llm-config.ts` list handler does the identical enrich via `Promise.all(map)`, and `OpenRouterModelCache` coalesces in-flight fetches (so the concurrent shape is the intended one). Flagged by #1419 review as a consistency-with-precedent gap. **Why not now**: the `Promise.all(map).flat()` rewrite pushed `routes/user/model-override.ts` over the 400-line `max-lines` cap (405), which would force an extraction (new helper + colocated test) — disproportionate for a warm-cache perf nicety. **Fix shape**: extract a `buildOverrideSummary(override, slot, capabilities)` helper (DRYs the LIST + SET emitters _and_ makes room), then `Promise.all` the LIST map. **Promote when**: next touching the override route, or when override-list latency matters. Surfaced 2026-07-01 (PR #1419 review, non-blocking).
<!-- SECTION:DESCRIPTION:END -->
