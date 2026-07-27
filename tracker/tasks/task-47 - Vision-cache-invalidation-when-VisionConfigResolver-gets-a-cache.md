---
id: TASK-47
title: 'Vision cache invalidation when VisionConfigResolver gets a cache'
status: To Do
assignee: []
created_date: '2026-06-28 00:00'
labels:
  - 'area:ai-worker'
  - 'origin:review'
dependencies: []
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Vision cache invalidation when `VisionConfigResolver` gets a cache

**Why:** The user-vision-default/override write+clear handlers (`model-override.ts`, shipped S2b/#1379) call `invalidateUserLlmConfig`, which only invalidates `LlmConfigResolver` (scoped `kind:'text'`). `VisionConfigResolver` reads `defaultVisionConfigId` / `visionConfigId` but is **not yet cache-wired into ai-worker's `cacheInvalidation.ts`** — so there's no vision cache to go stale TODAY (no runtime hazard). When a vision cache IS wired, those handlers must also invalidate it. **Fix shape**: add `invalidateUserVisionConfig` to `LlmConfigCacheInvalidationService` + call it from the vision write/clear paths when `isVision`. **Promote when**: `VisionConfigResolver` is wired into `ai-worker/src/cacheInvalidation.ts` (likely S2c or later). Surfaced 2026-06-28 (S2b #1379 review).
<!-- SECTION:DESCRIPTION:END -->
