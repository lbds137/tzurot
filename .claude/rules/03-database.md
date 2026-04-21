# Database Rules

## Connection Management

```typescript
// ✅ GOOD - Reuse singleton from common-types
import { getPrismaClient } from '@tzurot/common-types';

// ❌ BAD - Creates new connection every time
const prisma = new PrismaClient(); // Don't do this!
```

**Pool configuration:** `connectionLimit = 20` per service (Railway limit is 100)

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

**Migrations are NOT auto-applied on Railway.** After any deployment that includes new migrations, you MUST manually run:

```bash
pnpm ops db:migrate --env dev   # Apply to development
pnpm ops db:migrate --env prod  # Apply to production (requires confirmation)
```

Forgetting this causes Prisma `P2002` and other constraint errors at runtime because the code expects schema changes that haven't been applied yet.

### Protected Indexes (CRITICAL)

Prisma tries to DROP these indexes in migrations - ALWAYS review and remove:

| Index                             | Type           | Why Protected                                 |
| --------------------------------- | -------------- | --------------------------------------------- |
| `idx_memories_embedding`          | IVFFlat vector | 100x slower queries if dropped                |
| `memories_chunk_group_id_idx`     | Partial B-tree | Prisma can't represent WHERE clauses          |
| `llm_configs_free_default_unique` | Partial unique | Prisma can't represent partial unique indexes |
| `llm_configs_global_name_unique`  | Partial unique | Prisma can't represent partial unique indexes |
| `idx_memories_is_locked`          | Partial B-tree | Prisma can't represent WHERE clauses          |

**Source of truth**: `prisma/drift-ignore.json` has a two-tier structure for index protection — pick the right tier when adding new entries:

- **`ignorePatterns`** — list of regexes that strip unwanted SQL from Prisma's generated migration. Most entries are `DROP INDEX` patterns (the index should survive Prisma's drop), but the array also handles `CREATE INDEX` patterns where Prisma generates the wrong shape. For example, `memories_chunk_group_id_idx` has both a DROP entry **and** a CREATE entry — Prisma emits a non-partial CREATE that gets stripped, and the manually-written partial-index CREATE in the migration body is what actually applies. Use this for any generated SQL that should be suppressed; it's the minimum required for any partial/special index Prisma can't represent.
- **`protectedIndexes`** — DROP suppression **plus** full `recreateSQL`. Add an entry here only if you also need a recovery path: someone accidentally drops the index and you want a one-line recreate. The IVFFlat vector index lives here because losing it would silently degrade query performance by 100x and you'd want the SQL ready to paste back in.

The 5 indexes above are split: `idx_memories_embedding` and `memories_chunk_group_id_idx` are in **both** arrays (DROP suppression + recreate SQL); `llm_configs_free_default_unique`, `llm_configs_global_name_unique`, and `idx_memories_is_locked` are in **`ignorePatterns` only** (DROP suppression alone is enough — they have no expensive recreate cost). When adding a new partial/special index, default to `ignorePatterns`-only and only promote to `protectedIndexes` if recovery SQL would be valuable.

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

| Cache              | Location                     | TTL   | Type                     |
| ------------------ | ---------------------------- | ----- | ------------------------ |
| Channel Activation | `GatewayClient.ts`           | 30s   | TTLCache + pub/sub       |
| Admin Settings     | `GatewayClient.ts`           | 30s   | TTLCache (in-memory)     |
| Personality        | `PersonalityService.ts`      | 5 min | TTLCache + pub/sub       |
| Personality IDs    | `PersonalityIdCache.ts`      | 5 min | Custom (in-memory)       |
| Denylist           | `DenylistCache.ts`           | -     | In-memory + pub/sub      |
| User               | `UserService.ts`             | 5 min | TTLCache (in-memory)     |
| Autocomplete       | `autocompleteCache.ts`       | 30s   | TTLCache (in-memory)     |
| OpenRouter Models  | `OpenRouterModelCache.ts`    | 24h   | Redis-backed             |
| Vision Description | `VisionDescriptionCache.ts`  | 1h    | L1 Redis + L2 PostgreSQL |
| Voice Transcript   | `VoiceTranscriptCache.ts`    | -     | Custom (in-memory)       |
| Redis Dedup        | `RedisDeduplicationCache.ts` | TTL   | Redis-backed             |

**Cache invalidation services** (Redis pub/sub): `CacheInvalidationService`, `LlmConfigCacheInvalidationService`, `ChannelActivationCacheInvalidationService`, `ApiKeyCacheInvalidationService`, `PersonaCacheInvalidationService`

**Full cache audit:** `docs/reference/architecture/CACHING_AUDIT.md`
