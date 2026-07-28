---
id: TASK-37
title: Negative cache for LlmConfigResolver.getFreeDefaultConfig (parity)
status: To Do
assignee: []
created_date: '2026-07-01 00:00'
updated_date: '2026-07-28 10:46'
labels:
  - 'origin:review'
  - 'area:config-resolver'
  - 'size:S'
dependencies: []
priority: low
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Backport a negative cache to `LlmConfigResolver.getFreeDefaultConfig()` for parity with the vision reader

**Why:** Phase 4 Slice A added a negative-result cache to `VisionConfigResolver.getFreeDefaultVisionConfig()` (skips re-querying the DB when no free-vision default is set), but its sibling `LlmConfigResolver.getFreeDefaultConfig()` — which this method mirrors — has NO negative cache: every guest-mode call with no free-text-default configured re-queries `AdminSettings`. Strict improvement in the vision path; the two "analogue" methods now diverge in caching. **Fix shape**: mirror the `noDefaultCache` + `FREE_DEFAULT_CACHE_KEY` sentinel pattern into `LlmConfigResolver.getFreeDefaultConfig()`. **Why not now**: out of Slice A's scope (vision reader); it's a text-path perf nicety, not a correctness issue. **Promote when**: next touch of `LlmConfigResolver`, or if guest-mode free-default DB re-queries show up as load. Surfaced 2026-07-01 (PR #1426 review, non-blocking).
<!-- SECTION:DESCRIPTION:END -->
