---
id: TASK-847
title: >-
  Duplicated subscriber connection has no error listener, so Redis connection
  errors bypass structured logging
status: To Do
assignee: []
created_date: '2026-08-31 21:24'
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

Not yet established, and worth settling before choosing a fix: whether ioredis re-subscribes automatically on reconnect for this connection. If it does, the impact is observability only; if it does not, invalidation events stop permanently after any blip and the fix is a resubscribe on the reconnect event, not just a log line.

Fix shape: attach an error listener on the duplicated connection that logs through this.logger, and decide the reconnect question above before adding anything more. Consider whether isSubscribed should reflect connection health rather than merely non-null.

Related: TASK-846 covers a different failure of the same method (early-return caller left with no live subscriber).

Acceptance: subscriber connection errors appear in structured logs with the service name; the reconnect question is answered in this task; if resubscribe does not happen automatically, delivery is restored after a reconnect and a test pins it.
<!-- SECTION:DESCRIPTION:END -->
