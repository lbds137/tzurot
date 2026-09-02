---
id: TASK-861
title: >-
  Port the single-flight subscribe and identity-guarded cleanup from
  BaseCacheInvalidationService to the standalone CacheInvalidationService
status: Done
assignee: []
created_date: '2026-09-02 02:54'
updated_date: '2026-09-02 13:00'
labels:
  - 'area:cache-invalidation'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 861000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the beta.213 holistic release review (PR #2296) found that packages/cache-invalidation/src/CacheInvalidationService.ts — the standalone personality-cache class, not a BaseCacheInvalidationService subclass, constructed in bot-client/src/index.ts, api-gateway/src/index.ts, and ai-worker/src/cacheInvalidation.ts — received only the pre-handshake error listener from #2289. It has no connectPromise single-flight guard, and its catch and shutdown paths still do an unconditional this.subscriber.disconnect(); this.subscriber = null (lines ~126-127 and ~180-181 at 4285391de), which the base class replaced with a connection-identity-guarded cleanup under TASK-843/846/847. Verified by grep: connectPromise appears in BaseCacheInvalidationService.ts and nowhere in the standalone class.

Fix shape: either (a) port the single-flight subscribe (shared connect attempt, identity-guarded reset in the catch, torn-down-while-connecting check after the handshake) plus the identity-guarded disconnect to the standalone class, mirroring BaseCacheInvalidationService.ts:174-220 and its tests; or (b) migrate the standalone class onto BaseCacheInvalidationService so there is one implementation. (b) is the cleaner end state; check whether the standalone class carries behavior the base class lacks before choosing. Adjacent to TASK-858 (subscribe/unsubscribe idempotency) — resolve both in one PR if the port lands.

Acceptance: concurrent subscribe() callers on the standalone class share one connect attempt and all observe a failure; a shutdown racing a connect cannot leave a caller believing it is subscribed; the tests that pin these on the base class have counterparts on the standalone class (or the standalone class is gone).
<!-- SECTION:DESCRIPTION:END -->
