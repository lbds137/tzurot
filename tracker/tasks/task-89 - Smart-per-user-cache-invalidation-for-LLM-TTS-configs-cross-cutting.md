---
id: TASK-89
title: 'Smart per-user cache invalidation for LLM + TTS configs (cross-cutting)'
status: To Do
assignee: []
created_date: '2026-05-03 00:00'
labels:
  - 'area:voice'
dependencies: []
ordinal: 89000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Smart per-user cache invalidation for LLM + TTS configs (cross-cutting)

**Why:** `LlmConfigService.invalidateCacheSafely()` and the `TtsConfigService` mirror both call `cacheInvalidation.invalidateAll()` on every mutation, nuking every user's TTLCache. Better pattern (`ConfigCascadeCacheInvalidationService`) exists but isn't used. Upgrade BOTH services together: enumerate affected users, publish per-user events, only invalidate-all for unenumerable changes (e.g., `setAsFreeDefault`). ~200-300 LOC across both services + tests. **Promote when**: opportunistic when next touching either config service, OR if unconditional invalidation produces measurable cache-thrash in production. Surfaced 2026-05-03. Deferred 2026-05-07.
<!-- SECTION:DESCRIPTION:END -->
