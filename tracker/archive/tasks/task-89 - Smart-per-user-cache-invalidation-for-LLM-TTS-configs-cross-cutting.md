---
id: TASK-89
title: Smart per-user cache invalidation for LLM + TTS configs (cross-cutting)
status: To Do
assignee: []
created_date: '2026-05-03 00:00'
updated_date: '2026-09-04 20:07'
labels:
  - 'area:voice'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 89000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Smart per-user cache invalidation for LLM + TTS configs (cross-cutting)

**Why:** `LlmConfigService.invalidateCacheSafely()` and the `TtsConfigService` mirror both call `cacheInvalidation.invalidateAll()` on every mutation, nuking every user's TTLCache. Better pattern (`ConfigCascadeCacheInvalidationService`) exists but isn't used. Upgrade BOTH services together: enumerate affected users, publish per-user events, only invalidate-all for unenumerable changes (e.g., `setAsFreeDefault`). ~200-300 LOC across both services + tests. **Promote when**: opportunistic when next touching either config service, OR if unconditional invalidation produces measurable cache-thrash in production. Surfaced 2026-05-03. Deferred 2026-05-07.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:07
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-95 (Idea Config service and config schema refactor family); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-89 finds it.
---
<!-- COMMENTS:END -->
