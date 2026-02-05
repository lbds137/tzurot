---
name: tzurot-db-vector
description: 'Database migration procedures. Invoke with /tzurot-db-vector for Prisma migrations, drift fixes, and pgvector operations.'
lastUpdated: '2026-02-04'
---

# Database & Vector Procedures

**Invoke with /tzurot-db-vector** for migration and database operations.

**Rules for queries and caching are in `.claude/rules/03-database.md`** - they apply automatically.

## Migration Procedure

### 1. Create Migration (Preferred)

```bash
# Automatically sanitizes drift patterns
pnpm ops db:safe-migrate
```

This script:

1. Runs `prisma migrate dev --create-only`
2. Removes known drift patterns from `prisma/drift-ignore.json`
3. Reports what was sanitized
4. Shows the clean migration for review

### 2. Review SQL (CRITICAL)

Delete any lines matching:

- `DROP INDEX "idx_memories_embedding"`
- `DROP INDEX "memories_chunk_group_id_idx"`
- `CREATE INDEX "memories_chunk_group_id_idx"` (without WHERE)

### 3. Apply Migration

```bash
# Local
npx prisma migrate deploy

# Railway
pnpm ops db:migrate --env dev
pnpm ops db:migrate --env prod --force  # Prod requires --force
```

## Drift Detection & Fix

```bash
# Check all migrations for drift
pnpm ops db:check-drift

# Fix specific migration (non-destructive)
pnpm ops db:fix-drift 20251213200000_add_tombstones
```

**When safe to fix:** Formatting/whitespace changes only
**When NOT to fix:** Actual SQL logic was changed → create new migration

## Database Inspection

```bash
# Show tables, indexes, migrations
pnpm ops db:inspect

# Inspect specific table
pnpm ops db:inspect --table memories

# Show indexes only
pnpm ops db:inspect --indexes
```

## Vector Operations

### Store Embedding

```typescript
const embeddingStr = `[${embedding.join(',')}]`;
await prisma.$executeRaw`
  INSERT INTO memories (id, "personalityId", content, embedding, "createdAt")
  VALUES (gen_random_uuid(), ${id}::uuid, ${content}, ${embeddingStr}::vector, NOW())
`;
```

### Similarity Search

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

## Protected Indexes (CRITICAL)

| Index                         | Type           | Why Protected                                   |
| ----------------------------- | -------------- | ----------------------------------------------- |
| `idx_memories_embedding`      | IVFFlat vector | Prisma doesn't support Unsupported type indexes |
| `memories_chunk_group_id_idx` | Partial B-tree | Prisma can't represent WHERE clauses            |

### Recover If Dropped

```sql
-- IVFFlat vector index
CREATE INDEX IF NOT EXISTS idx_memories_embedding
ON memories USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 50);

-- Partial index for chunk groups
DROP INDEX IF EXISTS "memories_chunk_group_id_idx";
CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id")
WHERE "chunk_group_id" IS NOT NULL;
```

## PGLite Schema Regeneration

After Prisma schema changes:

```bash
./scripts/testing/regenerate-pglite-schema.sh
# Output: packages/test-utils/schema/pglite-schema.sql
```

## References

- Prisma docs: https://www.prisma.io/docs
- pgvector docs: https://github.com/pgvector/pgvector
- Schema: `prisma/schema.prisma`
- Rules: `.claude/rules/03-database.md`
