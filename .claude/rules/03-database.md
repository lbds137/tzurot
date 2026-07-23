# Database Rules

## Connection Management

```typescript
// ✅ GOOD - Reuse singleton from common-types
import { getPrismaClient } from '@tzurot/common-types';

// ❌ BAD - Creates new connection every time
const prisma = new PrismaClient(); // Don't do this!
```

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

### The One True Workflow

```bash
# 1. Create migration (sanitizes drift patterns automatically)
pnpm ops db:safe-migrate --name <migration_name>

# 2. Apply locally
pnpm ops db:migrate

# 3. Regenerate PGLite test schema
pnpm ops test:generate-schema

# 4. Check status / deploy to Railway
pnpm ops db:status --env dev
pnpm ops db:migrate --env dev
```

All commands work in non-interactive environments (AI assistants, CI).

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
- **`protectedIndexes`** — DROP suppression **plus** full `recreateSQL`. Add an entry here only if you also need a recovery path: someone accidentally drops the index and you want a one-line recreate. The IVFFlat vector index lives here because losing it would silently degrade query performance by 100x and you'd want the SQL ready to paste back in.

The indexes above are split: `idx_memories_embedding` and `memories_chunk_group_id_idx` are in **both** arrays (DROP suppression + recreate SQL); `llm_configs_free_default_unique`, `llm_configs_global_name_unique`, `llm_configs_default_unique`, `tts_configs_free_default_unique`, `tts_configs_global_name_unique`, `idx_memories_is_locked`, and `idx_memories_null_embedding` are in **`ignorePatterns` only** (DROP suppression alone is enough — they have no expensive recreate cost). When adding a new partial/special index, default to `ignorePatterns`-only and only promote to `protectedIndexes` if recovery SQL would be valuable.

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

| Cache              | Location                     | TTL   | Type                   |
| ------------------ | ---------------------------- | ----- | ---------------------- |
| Channel Activation | `GatewayClient.ts`           | 30s   | TTLCache + pub/sub     |
| Admin Settings     | `GatewayClient.ts`           | 30s   | TTLCache (in-memory)   |
| Personality        | `PersonalityService.ts`      | 5 min | TTLCache + pub/sub     |
| Personality IDs    | `PersonalityIdCache.ts`      | 5 min | Custom (in-memory)     |
| Denylist           | `DenylistCache.ts`           | -     | In-memory + pub/sub    |
| User               | `UserService.ts`             | 5 min | TTLCache (in-memory)   |
| Autocomplete       | `autocompleteCache.ts`       | 60s   | TTLCache (in-memory)   |
| OpenRouter Models  | `OpenRouterModelCache.ts`    | 24h   | Redis-backed           |
| Vision Description | `VisionDescriptionCache.ts`  | 1h    | Redis-backed (L1 only) |
| Voice Transcript   | `VoiceTranscriptCache.ts`    | -     | Custom (in-memory)     |
| Redis Dedup        | `RedisDeduplicationCache.ts` | TTL   | Redis-backed           |

**Cache invalidation services** (Redis pub/sub): `CacheInvalidationService`, `LlmConfigCacheInvalidationService`, `ChannelActivationCacheInvalidationService`, `ApiKeyCacheInvalidationService`, `PersonaCacheInvalidationService`

**Full cache audit:** `docs/reference/architecture/CACHING_AUDIT.md`
