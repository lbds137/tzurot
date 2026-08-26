# Redis Maintenance

Procedures for inspecting and maintaining Redis in dev and prod.

Redis carries two very different workloads here: **BullMQ queues** (jobs whose
payloads include conversation history, so tens of KB each) and a large set of
**cache/state keys** (sessions, dedup markers, multi-tag coordination, cached
transcripts and vision descriptions). Most maintenance concerns the first.

## The queues

Five BullMQ queues exist. Names are defined in
`packages/common-types/src/constants/queue.ts`, except the main one, which is
the `QUEUE_NAME` env var (default `ai-requests`) — so always resolve it from the
environment rather than hardcoding it.

| Queue               | Constant                       | Producer    | Consumer   | Carries                                                     |
| ------------------- | ------------------------------ | ----------- | ---------- | ----------------------------------------------------------- |
| `ai-requests`       | `QUEUE_NAME` (env, default)    | api-gateway | ai-worker  | LLM generation + audio/image preprocessing, imports/exports |
| `scheduled-jobs`    | `SCHEDULED_QUEUE_NAME`         | ai-worker   | ai-worker  | Repeatable cron: pending-memory processing, cleanup         |
| `fact-extraction`   | `FACT_EXTRACTION_QUEUE_NAME`   | ai-worker   | ai-worker  | Async fact extraction from episodes                         |
| `release-broadcast` | `RELEASE_BROADCAST_QUEUE_NAME` | api-gateway | bot-client | Release-notes / broadcast DM delivery                       |
| `retention-notify`  | `RETENTION_NOTIFY_QUEUE_NAME`  | api-gateway | bot-client | Retention warning-DM delivery                               |

bot-client also opens a `QUEUE_NAME` handle for multi-tag state.

`release-broadcast` and `retention-notify` are deliberately separate,
single-purpose, concurrency-1 FIFO queues — their at-least-once delivery bound
depends on staying that way. Do not repurpose either for a new job type.

## Job retention

`QUEUE_CONFIG` in `packages/common-types/src/constants/queue.ts`:

| Setting                     | Value |
| --------------------------- | ----- |
| `COMPLETED_HISTORY_LIMIT`   | 10    |
| `FAILED_HISTORY_LIMIT`      | 50    |
| `SCHEDULED_COMPLETED_LIMIT` | 10    |
| `SCHEDULED_FAILED_LIMIT`    | 50    |

BullMQ trims to these automatically as jobs complete or fail
(`removeOnComplete` / `removeOnFail`). Limits are low on purpose: each job
payload can be 50–100 KB, so a generous history is what turns Redis growth into
an incident.

## Inspecting queue state

Prefer the ops CLI over raw `redis-cli` — it resolves the environment's queue
name and Redis URL for you.

```bash
pnpm ops inspect:queue                              # dev, default queue
pnpm ops inspect:queue --env prod
pnpm ops inspect:queue --queue fact-extraction
pnpm ops inspect:queue --verbose --failed-limit 10  # include job data
```

Prints waiting / active / completed / failed / delayed / paused counts, then the
most recent failed jobs (id, name, attempts, failure reason — plus full job data
under `--verbose`) and the currently active jobs.

Dead-letter view — jobs that exhausted their retry attempts:

```bash
pnpm ops inspect:dlq                    # dev, default queue
pnpm ops inspect:dlq --env prod --limit 20
pnpm ops inspect:dlq --queue retention-notify --json
```

Prints per-job id, name, failed-at, created-at, attempts, error, the first five
stacktrace lines, and a data preview. `--json` emits full job details for
scripting.

Both commands accept `--env local|dev|prod` (default `dev`) and `--queue <name>`
(default: the environment's `QUEUE_NAME`, else `ai-requests`).

## Pausing the queues

`pnpm ops maintenance on --env prod` pauses the AI-requests and scheduled queues
and waits for active jobs to drain, in addition to putting the services behind
friendly rejections. That is the sanctioned way to quiet the queues — it resolves
the env's real queue name rather than a hardcoded literal, so it can't pause the
wrong one. `pnpm ops maintenance off --env prod` resumes. Full sequence in the
`/tzurot-deployment` skill.

While paused, waiting and delayed jobs park rather than being processed; nothing
is dropped.

## Raw Redis inspection

When the CLI isn't enough:

```bash
railway run --service ai-worker redis-cli INFO memory | grep used_memory_human
railway run --service ai-worker redis-cli DBSIZE

# Count a queue's keys (substitute the queue name)
railway run --service ai-worker redis-cli --scan --pattern "bull:ai-requests:*" | wc -l
```

Non-queue keys are namespaced by the prefixes in `REDIS_KEY_PREFIXES` (same
constants file) — `session:`, `dedup:`, `multitag:*`, `transcript:`,
`vision:canon:`, `job-result:`, and others. Each prefix's TTL and owner are
documented at the constant. Scanning by prefix is how you attribute unexpected
key growth to a subsystem.

**Do not hand-delete queue keys.** BullMQ's per-queue keys are a coordinated set
(job hashes plus the `waiting` / `active` / `completed` / `failed` / `delayed`
structures); deleting a subset by glob leaves the queue internally inconsistent
in ways that are much harder to diagnose than the space it reclaims. If retention
limits aren't holding, that's a bug to investigate, not a bucket to empty by
hand. If a queue genuinely must be reset, pause it via maintenance mode first and
use BullMQ's own `obliterate` semantics rather than `DEL` globs.

## Troubleshooting

### Redis slow, or command timeouts

Check memory pressure and key count first (`INFO memory`, `DBSIZE`). If the key
count is far above `(10 + 50) × queues + active`, retention isn't being applied
— confirm the queue was constructed with `removeOnComplete` / `removeOnFail`
from `QUEUE_CONFIG` rather than ad-hoc options.

Timeouts that aren't accompanied by memory pressure are usually connection-level.
The bounds live in `REDIS_CONNECTION` (`packages/common-types/src/constants/timing.ts`)
and are applied by `createIORedisClient` in
`packages/common-types/src/utils/redis.ts` — read those rather than a prose copy
of the numbers. Note that reconnection itself is deliberately **unbounded**
(ioredis default, capped backoff): a client keeps retrying rather than giving up
permanently, so a persistent timeout is a Redis- or network-side problem, not a
client that has stopped trying.

### Connection refused / errors on Railway

Connection settings are centralized in
`packages/common-types/src/utils/redis.ts`. Two constraints that bite when
something is constructed outside that helper:

- **IPv6 (`family: 6`) is required** for Railway private networking; IPv4 does
  not work there.
- **`maxRetriesPerRequest` must be `null`** for BullMQ connections, so BullMQ
  owns its own retry logic; a number makes IORedis give up and log errors while
  BullMQ silently keeps retrying. `createBullMQRedisConfig` sets it; non-BullMQ
  clients built by the other helpers keep a numeric value on purpose.

Connect and command timeouts come from `REDIS_CONNECTION` in
`packages/common-types/src/constants/timing.ts`. Build every connection through
the shared helpers rather than hand-rolling `new Redis(...)`.

### Jobs stuck active

`pnpm ops inspect:queue` shows the active list with job ids. A count above the
worker's concurrency setting means jobs are stalling rather than running —
check the consumer service's logs for that job id.

## Reference

- `packages/common-types/src/constants/queue.ts` — queue names, retention limits, key prefixes, pub/sub channels
- `packages/common-types/src/utils/redis.ts` — connection construction
- `packages/common-types/src/constants/timing.ts` — `REDIS_CONNECTION` timeout bounds
- [Operations Guide](../deployment/RAILWAY_OPERATIONS.md)
- [BullMQ docs](https://docs.bullmq.io/)
