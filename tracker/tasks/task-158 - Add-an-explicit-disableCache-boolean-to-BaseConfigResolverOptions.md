---
id: TASK-158
title: 'Add an explicit disableCache?: boolean to BaseConfigResolverOptions'
status: To Do
assignee: []
created_date: '2026-06-23 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:testing'
  - 'size:S'
dependencies: []
priority: low
ordinal: 158000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Add an explicit `disableCache?: boolean` to `BaseConfigResolverOptions`

**Why:** After #1316 swapped the identity `BaseConfigResolver` to `TTLCache`, `cacheTtlMs: 0` no longer disables the cache (lru-cache treats `ttl:0` as "never expire"). `identityProvisioning.component.test.ts` works around this with `cacheTtlMs: 1` (1ms), which relies on every PGLite round-trip exceeding 1ms — almost certainly true but a timing assumption. A cleaner fix is a `disableCache?: boolean` option that skips `cacheResult()` entirely (no timing assumption); the test could also `clearCache()` between assertions. **Fix shape**: add the option to `BaseConfigResolverOptions` + guard in `resolve()`/`cacheResult()`; switch the int test off `cacheTtlMs: 1`. **Promote when**: `identityProvisioning.component.test.ts` flakes on a cache-not-expiring failure, OR `BaseConfigResolverOptions` is next edited. Surfaced 2026-06-23 by PR #1316 round-3 claude-review (non-blocking; round-2 had approved `cacheTtlMs: 1` as correct).
<!-- SECTION:DESCRIPTION:END -->
