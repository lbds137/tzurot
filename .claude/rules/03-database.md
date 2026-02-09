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

### Protected Indexes (CRITICAL)

Prisma tries to DROP these indexes in migrations - ALWAYS review and remove:

| Index                         | Type           | Why Protected                        |
| ----------------------------- | -------------- | ------------------------------------ |
| `idx_memories_embedding`      | IVFFlat vector | 100x slower queries if dropped       |
| `memories_chunk_group_id_idx` | Partial B-tree | Prisma can't represent WHERE clauses |

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
| User               | `UserService.ts`             | 5 min | TTLCache (in-memory)     |
| Autocomplete       | `autocompleteCache.ts`       | 30s   | TTLCache (in-memory)     |
| OpenRouter Models  | `OpenRouterModelCache.ts`    | 24h   | Redis-backed             |
| Vision Description | `VisionDescriptionCache.ts`  | 1h    | L1 Redis + L2 PostgreSQL |
| Voice Transcript   | `VoiceTranscriptCache.ts`    | -     | Custom (in-memory)       |
| Redis Dedup        | `RedisDeduplicationCache.ts` | TTL   | Redis-backed             |

**Cache invalidation services** (Redis pub/sub): `CacheInvalidationService`, `LlmConfigCacheInvalidationService`, `ChannelActivationCacheInvalidationService`, `ApiKeyCacheInvalidationService`, `PersonaCacheInvalidationService`

**Full cache audit:** `docs/reference/architecture/CACHING_AUDIT.md`
