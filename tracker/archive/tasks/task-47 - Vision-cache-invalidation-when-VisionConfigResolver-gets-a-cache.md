---
id: TASK-47
title: Vision cache invalidation when VisionConfigResolver gets a cache
status: To Do
assignee: []
created_date: '2026-06-28 00:00'
updated_date: '2026-09-04 19:57'
labels:
  - 'area:ai-worker'
  - 'origin:review'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Vision cache invalidation when `VisionConfigResolver` gets a cache

**Why:** The user-vision-default/override write+clear handlers (`model-override.ts`, shipped S2b/#1379) call `invalidateUserLlmConfig`, which only invalidates `LlmConfigResolver` (scoped `kind:'text'`). `VisionConfigResolver` reads `defaultVisionConfigId` / `visionConfigId` but is **not yet cache-wired into ai-worker's `cacheInvalidation.ts`** — so there's no vision cache to go stale TODAY (no runtime hazard). When a vision cache IS wired, those handlers must also invalidate it. **Fix shape**: add `invalidateUserVisionConfig` to `LlmConfigCacheInvalidationService` + call it from the vision write/clear paths when `isVision`. **Promote when**: `VisionConfigResolver` is wired into `ai-worker/src/cacheInvalidation.ts` (likely S2c or later). Surfaced 2026-06-28 (S2b #1379 review).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:57
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-89 (Idea Silent degradation deferrals — the triggering change per member); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-47 finds it.
---
<!-- COMMENTS:END -->
