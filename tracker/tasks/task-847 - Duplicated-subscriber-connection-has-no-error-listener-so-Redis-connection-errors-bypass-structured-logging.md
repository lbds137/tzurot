---
id: TASK-847
title: >-
  Duplicated subscriber connection has no error listener, so Redis connection
  errors bypass structured logging
status: Done
assignee: []
created_date: '2026-08-31 21:24'
updated_date: '2026-09-01 22:14'
labels:
  - 'area:cache-invalidation'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 847000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: raised by claude-review on PR 2281 (observation 2, non-blocking) as adjacent pre-existing code. The reviewer framing and the first agent hypothesis were BOTH wrong; what follows is probed, not inferred.

What is true: BaseCacheInvalidationService.subscribe creates its subscriber via this.redis.duplicate(). duplicate() returns a fresh instance and does NOT copy listeners, and the only listener the class attaches is on("message") — verified by grep, one .on( call in the file. So the subscriber connection has no error listener of its own.

What is NOT true, and why neither claim should be repeated: (a) it does not crash. ioredis routes connection errors through silentEmit, which emits only when a listener exists and otherwise falls through — so the usual EventEmitter unhandled-error throw does not happen here. (b) it is not unlogged. That same fallback does console.error("[ioredis] Unhandled error event:", error.stack). Both facts read directly from ioredis built/Redis.js silentEmit; re-read before relying on them, a dependency bump can move this.

The actual gap, which is narrower than either framing: connection errors leave through console.error rather than the service pino logger, so they carry no serviceName, no structured fields, and no correlation id, and they will not match the message-text greps the deployment skill prescribes for prod log digs. Separately, isSubscribed() reports true whenever this.subscriber is non-null, which stays true across a dropped connection, so the method can claim a subscription that is not currently delivering.

ANSWERED (probed 2026-09-01, installed ioredis under packages/cache-invalidation/node_modules): ioredis DOES re-subscribe automatically on reconnect. built/redis/event_handler.js:254-264 — the readyHandler, gated on condition.subscriber && options.autoResubscribe, replays condition.subscriber.channels("subscribe") via self.subscribe(). autoResubscribe defaults to true (built/redis/RedisOptions.js:45) and no production code overrides it or disables retryStrategy (repo grep: only test-utils touches retryStrategy, test-only). So a dropped subscriber connection self-heals — reconnect, resubscribe, delivery resumes with callbacks intact — and this task is OBSERVABILITY-ONLY, size:S confirmed. isSubscribed() staying true across a drop is therefore eventually-consistent-correct, not a delivery lie; it wants a doc comment, not a health check. Re-read the cited lines before relying on them after any ioredis bump.

Fix shape (now settled): attach an error listener on the duplicated connection that logs through this.logger (warn level, err field first per pino rules), noting in the comment that ioredis reconnects and resubscribes on its own (hedged with the probe cite, since that is an external-system claim). Add a doc comment on isSubscribed() stating it reports intent, not liveness. Test: emit "error" on the mocked connection, assert logger.warn with the err field and no throw.

Related: TASK-846 covers a different failure of the same method (early-return caller left with no live subscriber).

Acceptance: subscriber connection errors appear in structured logs with the service name; the reconnect question is answered in this task; if resubscribe does not happen automatically, delivery is restored after a reconnect and a test pins it.
<!-- SECTION:DESCRIPTION:END -->
