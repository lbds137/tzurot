---
id: TASK-82
title: 'tryResolveUserKey no-key negative caching'
status: To Do
assignee: []
created_date: '2026-04-27 00:00'
labels:
  - 'area:ai-worker'
dependencies: []
ordinal: 82000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`tryResolveUserKey` no-key negative caching

**Why:** For `zai-coding`-with-no-key (the auto-fallthrough majority path), `tryResolveUserKey` returns `null` without cache write → every request re-reads DB. Currently accepted overhead documented in code comment at `services/ai-worker/src/services/ApiKeyResolver.ts`; `resolveApiKey`'s `source: 'system'` semantics can't be reused because `zai-coding` has no system fallback. Invariant test (do-not-cache-null-path) shipped via PR #925 — locks in current behavior so a future caching change is a deliberate, test-failure-inducing decision rather than a silent regression. **Fix shape (caching)**: introduce a distinct cache state for "no user key configured" (e.g., `source: 'absent'` discriminant or sentinel value), populate it from `tryResolveUserKey`'s null branch, short-circuit subsequent reads through the same entry-point. Touches `ApiKeyResolver`'s cache shape; likely needs co-update to `resolveApiKey` callers that peek the cache directly. **Promote when**: production logs show measurable per-request DB-read load on the fallthrough path, OR if a 2nd auto-fallthrough provider lands and the duplicate-DB-read pattern compounds. Surfaced 2026-04-27 PR #924 round 7. Deferred 2026-05-01.
<!-- SECTION:DESCRIPTION:END -->
