---
name: tzurot-db-vector
description: 'Database migration procedures. Invoke with /tzurot-db-vector for Prisma migrations, drift fixes, and pgvector operations.'
lastUpdated: '2026-02-09'
---

# Database & Vector Procedures

**Invoke with /tzurot-db-vector** for migration and database operations.

**Rules for queries and caching are in `.claude/rules/03-database.md`** - they apply automatically.

## Migration Procedure

### 1. Create Migration

```bash
# Interactive (prompts for name)
pnpm ops db:safe-migrate

# Non-interactive (AI assistants, CI)
pnpm ops db:safe-migrate --name <migration_name>
```

This command:

1. Tries `prisma migrate dev --create-only` (interactive path)
2. Falls back to `prisma migrate diff` if stdin is not a TTY (non-interactive)
3. Removes known drift patterns from `prisma/drift-ignore.json`
4. Reports what was sanitized
5. Shows the clean migration for review

**All `pnpm ops db:*` commands work in non-interactive environments.**

### 2. Review SQL (CRITICAL)

The safe-migrate command auto-sanitizes these, but always verify:

- `DROP INDEX "idx_memories_embedding"` — removed (IVFFlat vector index)
- `DROP INDEX "memories_chunk_group_id_idx"` — removed (partial index)
- `CREATE INDEX "memories_chunk_group_id_idx"` without WHERE — removed (non-partial)

### 3. Apply Migration

```bash
# Apply locally + regenerate Prisma client
pnpm ops db:migrate

# Regenerate PGLite test schema
pnpm ops test:generate-schema

# Apply to Railway
pnpm ops db:migrate --env dev
pnpm ops db:migrate --env prod --force  # Prod requires --force
```

`db:migrate` uses `prisma migrate deploy` (not `migrate dev`) for all environments.
This avoids interactive prompts and drift-detection loops from sanitized indexes.

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

After any migration:

```bash
pnpm ops test:generate-schema
# Output: packages/test-utils/schema/pglite-schema.sql
```

## References

- Prisma docs: https://www.prisma.io/docs
- pgvector docs: https://github.com/pgvector/pgvector
- Schema: `prisma/schema.prisma`
- Rules: `.claude/rules/03-database.md`
