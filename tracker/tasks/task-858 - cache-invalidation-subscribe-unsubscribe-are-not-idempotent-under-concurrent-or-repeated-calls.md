---
id: TASK-858
title: >-
  cache-invalidation subscribe/unsubscribe are not idempotent under concurrent
  or repeated calls
status: Done
assignee: []
created_date: '2026-09-01 22:14'
updated_date: '2026-09-02 13:00'
labels:
  - 'area:cache-invalidation'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 858000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two low findings from the #2289 review rounds, both pre-existing and both outside that fix. (1) unsubscribe() has no single-flight guard: two overlapping calls both pass the truthy this.subscriber check before either nulls it, so both call .unsubscribe()/.disconnect() on the same connection object. Shutdown-only in the current lifecycle (every service calls it once), so harmless today. (2) subscribe(sameFn) pushes the callback unconditionally, so a caller that subscribes the same reference twice gets it invoked twice per event; every production call site subscribes once at startup, so not reachable today either.

Fix shape: (1) a single-flight teardownPromise mirroring connectPromise, or a synchronous null-out before the awaited unsubscribe; test with two overlapping unsubscribe() calls asserting one .disconnect(). (2) either dedupe by reference in subscribe() with a debug log, or document non-idempotence in the JSDoc — decide, then pin with a test either way. Both live in packages/cache-invalidation/src/BaseCacheInvalidationService.ts; the Stryker floor (97.53) applies.

Acceptance: overlapping unsubscribe() calls tear down exactly once (test); subscribe(sameFn) twice has a decided, tested behavior.
<!-- SECTION:DESCRIPTION:END -->
