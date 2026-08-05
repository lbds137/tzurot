---
id: TASK-193
title: refreshCache() can join the in-flight guard instead of forcing a fresh load
status: To Do
assignee: []
created_date: '2026-06-30 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'area:redis'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 193000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`refreshCache()` can join the in-flight guard instead of forcing a fresh load

**Why:** PR #1406 added a `getModels()` in-flight guard (concurrent cold callers share one fetch). `OpenRouterModelCache.refreshCache()` clears both cache tiers + calls `getModels()` to force a fresh load — but with the guard, if a cold `getModels()` is already in flight, `refreshCache`'s call JOINS it and returns possibly-pre-`del()` data (admin-only path, narrow race). An inline fix was attempted + reverted because it's subtle: naively nulling `this.inFlight` BEFORE `await redis.del()` opens a worse window — a concurrent caller arriving during the `del` await reads the not-yet-deleted stale Redis key and warms `memoryCache` with stale data for the full 5-min TTL. **Fix shape**: null `this.inFlight` AFTER `await redis.del()` (so `refreshCache`'s own `getModels()` loads against an emptied Redis), plus a test that seeds a stale Redis key and asserts the refresh returns fresh data — NOT a `redis.get→null` mock (that can't catch the stale-key poisoning). **Promote when**: `refreshCache` becomes a user-visible/automated trigger, or admin cache-refresh races are observed. Surfaced 2026-06-30 by PR #1406 review (non-blocking; reviewer's original guidance was "backlog this").
<!-- SECTION:DESCRIPTION:END -->
