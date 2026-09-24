# Database Rules

## Connection Management

Construct Prisma only through the shared factory — `const { prisma, dispose } = createPrismaClient()` from `@tzurot/common-types/services/prisma`, which owns the `pg.Pool` + driver adapter. `new PrismaClient()` bypasses the adapter and THROWS under Prisma 7. Call `dispose()` when a one-shot process finishes (it stops the pool-stats gauge and closes the pool); one-shot scripts and migrations pass the transient pool size, `createPrismaClient({ max: DB_POOL_DEFAULTS.TRANSIENT_MAX })` (`DB_POOL_DEFAULTS` from `@tzurot/common-types/services/poolConfig`).

**Pool configuration** lives in `packages/common-types/src/services/poolConfig.ts` — default `max = 20` per service process (`DATABASE_POOL_MAX`), finite `DATABASE_POOL_CONN_TIMEOUT_MS` acquisition timeout, `DATABASE_POOL_STATS_INTERVAL_MS` for the saturation gauge. **The driver adapter ignores the `?connection_limit=` URL param** — set pool size in `poolConfig.ts`/env, never on `DATABASE_URL`. Keep Σ `max` across all service processes/replicas under Postgres `max_connections` (~100 on Railway).

## Query Patterns

### Bounded Queries (CRITICAL)

Every `findMany` MUST have a `take` limit.

### Use Include to Avoid N+1

Load relations with `include` (`findMany({ include: { llmConfig: true } })`), not a query per row.

## pgvector Operations

Similarity search goes through `prisma.$queryRaw`, never the ORM. Canonical query: `services/ai-worker/src/services/PgvectorQueryBuilder.ts` — cosine distance `<=>` (0 = identical, 2 = opposite), bounded by a max distance, `ORDER BY distance`, `LIMIT`.

## Indexes Ship With Their Query

**A new index must land in the same PR as a query that uses it** (or name the existing query it backs, verifiable by grep). A speculative index pays its write-path maintenance cost immediately while its read benefit never arrives. When reviewing a migration that adds an index, ask "which query?" — no query, no index.

Corollary for removals: `idx_scan = 0` alone never justifies a drop. Verify no query exists (raw AND Prisma) — an index backing a real query on a still-small table shows 0 scans only because the planner seq-scans; it becomes load-bearing as the table grows. PK/unique indexes are constraints, never drop candidates.

## Sync-Tracked Tables & `updated_at` (dev↔prod LWW)

`DatabaseSyncService` reconciles dev↔prod rows by **last-write-wins on `updated_at`** (`syncTables.ts`). Any Prisma client-level write (`update`/`updateMany`/`upsert`) auto-bumps `@updatedAt` — so a **high-frequency or non-semantic** write (an activity stamp, a counter, a `last_seen`) makes that env's row "win" the next sync and can silently clobber the other env's genuine edits.

**Rule**: write high-frequency/non-semantic columns on a sync-tracked table via **raw SQL** (`$executeRaw`) — it bypasses `@updatedAt`, leaving `updated_at` for genuine, sync-worthy state changes only. Reference: the retention `lastActiveAt`/`dmUndeliverableSince` stamps write via `$executeRaw` for exactly this reason.

## Migrations

Step-by-step workflow (safe-migrate → migrate → regenerate PGLite schema → deploy): `/tzurot-db-vector`.

**NEVER** use `prisma migrate reset` (destroys all data) or raw `prisma migrate` commands.

### Deployment (CRITICAL)

**Migrations are NOT auto-applied on Railway** — and the _timing_ matters, because every service auto-deploys in parallel.

**Prod (release): migrate BEFORE merging the release PR** — Railway auto-deploys every service the moment it merges to `main`, so migrating after leaves new code on the old schema for the deploy window. `pnpm ops release:premigrate --dry-run` previews, `pnpm ops release:premigrate` applies to prod; then merge (procedure: `/tzurot-git-workflow` § 4. Pre-Merge Migration).

Safe for **additive** migrations (a new column/table/constraint the old code ignores). **Destructive** migrations (drop/rename a column, tighten a constraint on existing data) invert the window — applying them breaks the still-live old code — so they need a brief maintenance window: `pnpm ops maintenance on --env prod` (friendly rejections + BullMQ drain) → `release:premigrate --allow-destructive` → merge → `pnpm ops maintenance off --env prod`. `release:premigrate` detects the likely-destructive shapes and refuses without `--allow-destructive`.

**A migration that must run AFTER the deploy** — typically a pure-DML reshape of data the old code still reads (a JSONB key rename, a value re-encoding), which reads as additive to the shape scan — declares itself with the SQL comment `-- tzurot:apply-after-deploy` on its own line. `release:premigrate` refuses on it and prints the correct order: merge the release PR, let auto-deploy land the new code, THEN `pnpm ops db:migrate --env prod`. `--allow-marked` overrides and premigrates anyway; when the release mixes marked and unmarked migrations the command enumerates both and leaves the call to you, because `prisma migrate deploy` cannot apply a subset.

**Dev:** dev auto-deploys on every push to `develop` — apply migrations promptly after the push (`pnpm ops db:migrate --env dev`). A forgotten migration surfaces as Prisma `P2002` and other constraint errors at runtime.

### Protected Indexes (CRITICAL)

Prisma tries to DROP these indexes in migrations — ALWAYS review and remove the DROP: the IVFFlat vector indexes `idx_memories_embedding` and `idx_memory_facts_embedding` (queries degrade to seq scans without them), and the partial indexes Prisma can't represent — `memories_chunk_group_id_idx`, `idx_memories_is_locked`, `idx_memories_null_embedding`, `llm_configs_free_default_unique`, `llm_configs_global_name_unique`, `llm_configs_default_unique`, `tts_configs_free_default_unique`, `tts_configs_global_name_unique`.

**Source of truth**: `prisma/drift-ignore.json`, in two tiers — `ignorePatterns` (regexes stripping generated SQL: DROP suppression, plus wrong-shape CREATEs) and `protectedIndexes` (DROP suppression **plus** `recreateSQL`, feeding the `pnpm ops db:check-safety` drop-without-recreate gate and `db:inspect`). When adding a new partial/special index, default to `ignorePatterns`-only and promote to `protectedIndexes` only if recovery SQL would be valuable. Which index sits in which tier, and why: `docs/reference/database/PRISMA_DRIFT_ISSUES.md` § Configuration.

### Optional Columns Require Null-Semantics Documentation

Every new `?` (optional) field added to `prisma/schema.prisma` MUST have a triple-slash documentation comment explaining what `null` means in application terms — a field gets `?` because null is a meaningful application state, never for code convenience. The four pattern shapes to state (state machine, default-fallback, deferred-set, state-machine-by-status), with examples: [`schema-audit.md`](../../docs/reference/tooling/schema-audit.md) § Null-semantics pattern shapes. `pnpm ops dev:schema-audit` detects the fake-optional bug shapes statically.

### Anti-Patterns

Never run SQL manually then mark it applied (use `migrate deploy`), never edit an applied migration (create a new one), never `railway run prisma migrate dev` (run locally with the `.env` `DATABASE_URL`).

## Caching

### Cache Decision Tree

```
Does staleness cause incorrect behavior?
├── YES → Redis + pub/sub invalidation
└── NO → Is it expensive external API data?
         ├── YES → Redis with TTL (or two-tier for persistence)
         └── NO → Is it rate limiting?
                  ├── YES → In-memory Map (local is correct)
                  └── NO → Probably don't need caching
```

### Redis counters: plain incr/expire, fail-open — no reflexive Lua

For counters, quotas, and rate limits at this project's scale, default to the
`VisionFallbackQuota` shape — plain `redis.incr` then compare against the
limit, `redis.expire` for the window, non-atomic, fail-open. Where reject-bleed
genuinely matters, fix it by ORDERING in plain TS (check before increment), not
with Lua: Lua/EVALSHA only prevents same-user concurrent overshoot — the safe
direction for a soft cap — while a nontrivial Lua script is untyped,
TS-untestable logic in a string. Reach for Lua only on a DEMONSTRATED
concurrency harm or a hard financial/security cap.

### TTLCache Usage

`new TTLCache<ValueType>({ ttl, maxSize })` from `@tzurot/common-types/utils/TTLCache` — `ttl` in milliseconds, `maxSize` bounds entries (LRU eviction).

### Existing Cache Implementations

Every cache sorts into a durability tier: **1** = recomputable for free, loss is correctness-neutral; **2** = costs money to regenerate and is conversation-scoped (the history row is the system of record; Redis is L1 only); **3** = costs money and the asset outlives the conversation (needs a home that is not a TTL). The per-cache TTL/tier table, the invalidation services, and how to sort a new cache: [`durability-tiers.md`](../../docs/reference/architecture/durability-tiers.md) — verify a row against its TTL constant before relying on it. [`CACHING_AUDIT.md`](../../docs/reference/architecture/CACHING_AUDIT.md) covers horizontal-scaling safety; its inventory is historical.
