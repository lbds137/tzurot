---
id: TASK-613
title: >-
  reconnectStrategy is a node-redis option name that ioredis ignores, so the
  bounded reconnect policy has never applied
status: Done
assignee: []
created_date: '2026-08-14 18:43'
updated_date: '2026-08-26 21:48'
labels:
  - 'area:common-types'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 613000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/common-types/src/utils/redis.ts defines createReconnectStrategy (give up after RETRY_CONFIG.REDIS_MAX_RETRIES=10) and attaches it as reconnectStrategy in both createRedisSocketConfig (line 129) and createBullMQRedisConfig (line 164). reconnectStrategy is the NODE-REDIS option name. ioredis calls it retryStrategy, and ignores the other.

PROBED, not inferred (ioredis 5.11.1, lazyConnect so no server needed): constructing a client WITH reconnectStrategy and one WITHOUT yields the IDENTICAL retryStrategy function reference, so the option changes nothing. The default retryStrategy never gives up - sampled returns are 50ms at 1 retry, 500ms at 10, 2000ms at 50 and at 500, capped, no Error ever returned.

Scope: createBullMQRedisConfig output is spread into BullMQ connection in roughly eight places across all three services (api-gateway/queue.ts, ai-worker/index.ts, bot-client index plus ResultsListener, JobFailureListener, setupReleaseDmWorker, setupRetentionNotifyWorker) and tooling/inspect. Every one of them has silently been running ioredis default unbounded retry rather than the bounded policy the code appears to configure.

Impact is benign to positive on availability - unbounded retry self-heals where the intended policy would have given up permanently - so this is NOT urgent. The defect is that a maintainer reading the file believes reconnects are bounded at 10 attempts when they are not, which is exactly the wrong premise to reason from during an incident. This surfaced when a PR 2102 reviewer flagged the give-up behavior as a live availability risk for api-gateway cacheRedis; the probe showed the mechanism cannot fire at all.

Second finding in the same file: createRedisSocketConfig has ZERO consumers - the only hit repo-wide is its own definition. It builds the node-redis nested socket shape which nothing in this codebase uses. Candidate for deletion; check why knip does not flag it (likely counted as public package API).

Third, lower: REDIS_CONNECTION.COMMAND_TIMEOUT is 30s fleet-wide. For the api-gateway dedup/rate-limit path a caller is blocked on, 30s to fail is a long bound even though it beats hanging forever. Raised as informational by the same reviewer. Only worth acting on if the bound is ever actually observed in practice; noted here so the observation is not lost.

Fix shape: decide whether the bounded policy was ever WANTED. If yes, rename to retryStrategy and verify it takes effect with a probe. If no, delete createReconnectStrategy and the dead createRedisSocketConfig, and say in a comment that ioredis default unbounded retry is the deliberate choice.

Acceptance: no config helper advertises a reconnect policy that does not take effect; a probe or test demonstrates whichever behavior is chosen; createRedisSocketConfig is deleted or given a consumer.
<!-- SECTION:DESCRIPTION:END -->
