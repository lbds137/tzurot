# Database Rules

## Connection Management

```typescript
// ✅ GOOD - the shared factory owns the pg.Pool + driver adapter
import { createPrismaClient } from '@tzurot/common-types/services/prisma';

const { prisma, dispose } = createPrismaClient();

// ❌ BAD - bypasses the adapter entirely; under Prisma 7 it THROWS at construction
const prisma = new PrismaClient();
```

Call `dispose()` when a one-shot process finishes — it stops the pool-stats gauge and closes the pool. One-shot scripts and migrations should also pass the transient pool size rather than the long-running app default: `createPrismaClient({ max: DB_POOL_DEFAULTS.TRANSIENT_MAX })`, with `DB_POOL_DEFAULTS` from `@tzurot/common-types/services/poolConfig`.

**Pool configuration:** The Prisma 7 driver adapter (`@prisma/adapter-pg`) runs over an explicit node-postgres `pg.Pool` configured in `packages/common-types/src/services/poolConfig.ts` — **default `max = 20` per service process**, env-tunable via `DATABASE_POOL_MAX`, with a finite `DATABASE_POOL_CONN_TIMEOUT_MS` (default 10s) acquisition timeout. **Gotcha:** the driver adapter **ignores the `?connection_limit=` URL param** — pool size MUST be set in `poolConfig.ts`/env, never on `DATABASE_URL`. The pool previously fell back to pg's defaults (`max = 10`, wait-forever acquisition), which starved under load. Set `DATABASE_POOL_STATS_INTERVAL_MS` to enable the saturation gauge (warns when connections queue). Keep total connections (Σ `max` across all service processes/replicas) under the Postgres `max_connections` (~100 on Railway).

## Query Patterns

### Bounded Queries (CRITICAL)

All `findMany` MUST have `take` limit:

```typescript
// ✅ GOOD
const items = await prisma.items.findMany({ take: 100 });

// ❌ BAD - Unbounded query
const items = await prisma.items.findMany();
```

### Use Include to Avoid N+1

```typescript
const personalities = await prisma.personality.findMany({
  include: { llmConfig: true },
});
```

## pgvector Operations

Use `Prisma.$queryRaw` for similarity search, not ORM:

```typescript
// Cosine distance: 0 = identical, 2 = opposite
const results = await prisma.$queryRaw<SimilarMemory[]>`
  SELECT id, content, 1 - (embedding <-> ${embeddingStr}::vector) as similarity
  FROM memories
  WHERE "personalityId" = ${personalityId}::uuid
  ORDER BY embedding <-> ${embeddingStr}::vector
  LIMIT ${limit}
`;
```

## Indexes Ship With Their Query

**A new index must land in the same PR as a query that uses it** (or name the existing query it backs, verifiable by grep). A speculative index is not free: its write-path maintenance costs land immediately while its read benefit never arrives — a GIN index added "for future JSONB queries" that were never built stalled prod inserts past the 6s query timeout and dead-ended a user response. When reviewing a migration that adds an index, ask "which query?" — no query, no index.

Corollary for removals: `idx_scan = 0` alone never justifies a drop. Verify no query exists (raw AND Prisma) — an index backing a real query on a still-small table shows 0 scans only because the planner seq-scans; it becomes load-bearing as the table grows. PK/unique indexes are constraints, never drop candidates.

## Sync-Tracked Tables & `updated_at` (dev↔prod LWW)

`DatabaseSyncService` reconciles dev↔prod rows by **last-write-wins on `updated_at`** (`syncTables.ts`). Any Prisma client-level write (`update`/`updateMany`/`upsert`) auto-bumps `@updatedAt` — so a **high-frequency or non-semantic** write (an activity stamp, a counter, a `last_seen`) makes that env's row "win" the next sync and can silently clobber the other env's genuine edits.

**Rule**: write high-frequency/non-semantic columns on a sync-tracked table via **raw SQL** (`$executeRaw`) — it bypasses `@updatedAt`, leaving `updated_at` for genuine, sync-worthy state changes only. Reference: the retention `lastActiveAt`/`dmUndeliverableSince` stamps write via `$executeRaw` for exactly this reason.

## Migrations

Step-by-step workflow (safe-migrate → migrate → regenerate PGLite schema → deploy): `/tzurot-db-vector`.

**NEVER** use `prisma migrate reset` (destroys all data) or raw `prisma migrate` commands.

### Deployment (CRITICAL)

**Migrations are NOT auto-applied on Railway** — and the _timing_ matters, because every service auto-deploys in parallel.

**Prod (release): migrate BEFORE merging the release PR.** Railway auto-deploys every service the moment the release PR merges to `main`; migrating _after_ that leaves new code running against the old schema for the deploy window (the beta.140 `column llm_configs.kind does not exist` incident). Migrate first, while prod still runs the old code:

```bash
pnpm ops release:premigrate --dry-run   # preview the new migrations in the release range
pnpm ops release:premigrate             # apply to prod, THEN merge the release PR
```

Safe for **additive** migrations (a new column/table/constraint the old code ignores). **Destructive** migrations (drop/rename a column, tighten a constraint on existing data) invert the window — applying them breaks the still-live old code — so they need a brief maintenance window: `pnpm ops maintenance on --env prod` (friendly rejections + BullMQ drain) → `release:premigrate --allow-destructive` → merge → `pnpm ops maintenance off --env prod`. `release:premigrate` detects the likely-destructive shapes and refuses without `--allow-destructive`.

**Dev:** dev auto-deploys on every push to `develop`, so there's no merge gate to run before — apply migrations promptly after the push (`pnpm ops db:migrate --env dev`); the brief window on dev is low-stakes.

Forgetting the migration causes Prisma `P2002` and other constraint errors at runtime because the code expects schema changes that haven't been applied yet.

### Protected Indexes (CRITICAL)

Prisma tries to DROP these indexes in migrations - ALWAYS review and remove:

| Index                             | Type           | Why Protected                                 |
| --------------------------------- | -------------- | --------------------------------------------- |
| `idx_memories_embedding`          | IVFFlat vector | 100x slower queries if dropped                |
| `idx_memory_facts_embedding`      | IVFFlat vector | Fact queries degrade to seq scans if dropped  |
| `memories_chunk_group_id_idx`     | Partial B-tree | Prisma can't represent WHERE clauses          |
| `llm_configs_free_default_unique` | Partial unique | Prisma can't represent partial unique indexes |
| `llm_configs_global_name_unique`  | Partial unique | Prisma can't represent partial unique indexes |
| `llm_configs_default_unique`      | Partial unique | Prisma can't represent partial unique indexes |
| `tts_configs_free_default_unique` | Partial unique | Prisma can't represent partial unique indexes |
| `tts_configs_global_name_unique`  | Partial unique | Prisma can't represent partial unique indexes |
| `idx_memories_is_locked`          | Partial B-tree | Prisma can't represent WHERE clauses          |
| `idx_memories_null_embedding`     | Partial B-tree | Prisma can't represent WHERE clauses          |

**Source of truth**: `prisma/drift-ignore.json` has a two-tier structure for index protection — pick the right tier when adding new entries:

- **`ignorePatterns`** — list of regexes that strip unwanted SQL from Prisma's generated migration. Most entries are `DROP INDEX` patterns (the index should survive Prisma's drop), but the array also handles `CREATE INDEX` patterns where Prisma generates the wrong shape. For example, `memories_chunk_group_id_idx` has both a DROP entry **and** a CREATE entry — Prisma emits a non-partial CREATE that gets stripped, and the manually-written partial-index CREATE in the migration body is what actually applies. Use this for any generated SQL that should be suppressed; it's the minimum required for any partial/special index Prisma can't represent.
- **`protectedIndexes`** — DROP suppression **plus** full `recreateSQL`, and the single source of truth for the drop-without-recreate gate (`pnpm ops db:check-safety` — run by `.husky/pre-commit` on any staged migration, by `pnpm quality`, and by the CI lint job; `protectedIndexRegistry.ts` loads and validates the entries, and `check-migration-safety.ts` compiles each `dropPattern`/`createPattern` to a `RegExp`) as well as for `db:inspect`'s live-DB presence report. Add an entry here only if you also need a recovery path: someone accidentally drops the index and you want a one-line recreate. The IVFFlat vector index lives here because losing it would silently degrade query performance by 100x and you'd want the SQL ready to paste back in.

The indexes above are split: `idx_memories_embedding` and `memories_chunk_group_id_idx` are in **both** arrays (DROP suppression + recreate SQL); `idx_memory_facts_embedding` is in **`protectedIndexes` only** (that one entry supplies both the DROP suppression and the recreate SQL); `llm_configs_free_default_unique`, `llm_configs_global_name_unique`, `llm_configs_default_unique`, `tts_configs_free_default_unique`, `tts_configs_global_name_unique`, `idx_memories_is_locked`, and `idx_memories_null_embedding` are in **`ignorePatterns` only** (DROP suppression alone is enough — they have no expensive recreate cost). When adding a new partial/special index, default to `ignorePatterns`-only and only promote to `protectedIndexes` if recovery SQL would be valuable.

### Optional Columns Require Null-Semantics Documentation

Every new `?` (optional) field added to `prisma/schema.prisma` MUST have a triple-slash documentation comment explaining what `null` means in application terms. This makes the schema self-documenting and prevents the class of bug where a field gets `?` for code-convenience reasons rather than because null is a meaningful application state.

**Pattern shapes** (use these in the doc to make the intent explicit):

| Pattern                     | Meaning                                                                                     | Example                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **State machine**           | Null until a specific event populates it; never reverts. Reads guard with `!= null` checks. | `/// Null until the user completes NSFW verification; populated to current time on success.` (`users.nsfwVerifiedAt`)                                                                               |
| **Default-fallback**        | Null means "use the cascade fallback." Reads use `?? globalDefault` to resolve.             | `/// User-level STT provider override; when NULL, transcription derives from the user's default TTS provider, otherwise falls back to the self-hosted voice-engine.` (`users.defaultSttProviderId`) |
| **Deferred-set**            | Null on creation, populated by a background worker / async job. Reads guard via truthiness. | `/// Populated by the PendingMemoryProcessor retry loop on each attempt; null on initial insert.` (`pending_memories.lastAttemptAt`)                                                                |
| **State-machine-by-status** | Tied to a status column; nullable while the row is not yet in the right state.              | `/// Null until job status='completed'; populated atomically with the status transition.` (`export_jobs.fileContent`)                                                                               |

**Why this rule exists**: a 4-month-undetected bug shipped because `users.default_persona_id` was nullable for code-convenience reasons (one creation path was inconvenient to fix). The bug was caught and fixed in Phase 5b, but the same pattern can recur on new columns. A self-documenting schema makes the next occurrence visible at review time.

**Enforcement**: `pnpm ops dev:schema-audit` (see [`docs/reference/tooling/schema-audit.md`](../../docs/reference/tooling/schema-audit.md)) detects the bug-shape patterns statically. The PR-template checkbox surfaces the requirement at every PR touching `prisma/schema.prisma`. Combined, the goal is to make a "fake-optional" column impossible to introduce silently.

### Anti-Patterns

| ❌ Don't                             | ✅ Instead                           |
| ------------------------------------ | ------------------------------------ |
| Run SQL manually then mark applied   | Use `migrate deploy`                 |
| Edit applied migrations              | Create new migration to fix          |
| Use `railway run prisma migrate dev` | Run locally with `.env` DATABASE_URL |

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

### TTLCache Usage

```typescript
import { TTLCache } from '@tzurot/common-types';

const cache = new TTLCache<ValueType>({
  ttl: 60 * 1000, // TTL in milliseconds
  maxSize: 100, // Maximum entries (LRU eviction)
});
```

### Existing Cache Implementations

`Tier` is the durability tier — see [durability-tiers.md](../../docs/reference/architecture/durability-tiers.md) for what each means and how to sort a new cache into one. **1** = recomputable for free, loss is correctness-neutral. **2** = costs money to regenerate and is conversation-scoped (the history row is the system of record; Redis is L1 only). **3** = costs money and the asset outlives the conversation (needs a home that is not a TTL).

| Cache               | Location                     | TTL           | Tier | Type                                 |
| ------------------- | ---------------------------- | ------------- | ---- | ------------------------------------ |
| Channel Activation  | `gatewayServiceCalls.ts`     | 30s           | 1    | TTLCache + pub/sub                   |
| Admin Settings      | `gatewayServiceCalls.ts`     | 60s           | 1    | TTLCache (in-memory)                 |
| Personality         | `PersonalityService.ts`      | 5 min         | 1    | TTLCache + pub/sub                   |
| Personality (bot)   | `HttpPersonalityLoader.ts`   | 5 min         | 1    | TTLCache (+ 60s negative)            |
| Denylist            | `DenylistCache.ts`           | -             | 1    | In-memory + pub/sub                  |
| User                | `UserService.ts`             | **1h**        | 1    | TTLCache (in-memory)                 |
| Autocomplete        | `autocompleteCache.ts`       | 60s           | 1    | TTLCache (+ LRU-bounded stale, 500)  |
| OpenRouter Models   | `OpenRouterModelCache.ts`    | **5 min/24h** | 1    | **Two-tier**: memory L1 → Redis      |
| Vision Description  | `VisionDescriptionCache.ts`  | 1h            | 2    | Redis L1 over `attachmentEnrichment` |
| Voice Transcript    | `VoiceTranscriptCache.ts`    | **1h**        | 2    | **Redis-backed**, L1 over the row    |
| Redis Dedup         | `RedisDeduplicationCache.ts` | configurable  | 1    | Redis-backed                         |
| Model Capability    | `ModelCapabilityChecker.ts`  | 5 min         | 1    | TTLCache (maxSize 500)               |
| Context-Length Memo | `ModelCapabilityChecker.ts`  | 24h           | 1    | TTLCache (maxSize 500)               |

Three rows were wrong before the durability audit and are corrected in bold: `User` said 5 min (it is 1h — `USER_CACHE_TTL_MS`), `OpenRouter Models` hid its 5-minute in-memory L1 in front of the 24h Redis entry, and `Voice Transcript` said "Custom (in-memory)" with no TTL when it is Redis `setex` at `INTERVALS.VOICE_TRANSCRIPT_TTL`. **Verify a row against the constant before relying on it** — every value here was re-read from source, and a stale TTL in an always-loaded table is a wrong premise in every session that reads it.

**Cache invalidation services** (Redis pub/sub): `CacheInvalidationService`, `LlmConfigCacheInvalidationService`, `ChannelActivationCacheInvalidationService`, `ApiKeyCacheInvalidationService`, `PersonaCacheInvalidationService`

**Durability tiers + full inventory:** [`docs/reference/architecture/durability-tiers.md`](../../docs/reference/architecture/durability-tiers.md). The older [`CACHING_AUDIT.md`](../../docs/reference/architecture/CACHING_AUDIT.md) covers a different axis (horizontal-scaling safety) and its inventory is historical.
