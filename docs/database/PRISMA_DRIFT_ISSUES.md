# Prisma Schema Drift Issues

This document tracks known cases where the database state intentionally differs from what Prisma can represent in `schema.prisma`. When running `prisma migrate dev --create-only`, Prisma may generate DROP statements for these items - **do not apply those drops**.

## Quick Reference: Scripts

```bash
# Inspect current database state (tables, indexes, migrations)
pnpm --filter @tzurot/scripts run db:inspect

# Inspect specific table
pnpm --filter @tzurot/scripts run db:inspect -- --table memories

# Create a migration with automatic drift sanitization
pnpm --filter @tzurot/scripts run db:migrate:safe -- <name>

# Check for checksum drift (modified migration files)
pnpm --filter @tzurot/scripts run db:check-drift

# Fix checksum drift
pnpm --filter @tzurot/scripts run db:fix-drift -- <migration_name>
```

## Background

Prisma uses the schema as the source of truth. When it detects database objects that aren't in the schema, it considers this "drift" and generates migrations to remove them. However, some PostgreSQL features cannot be represented in Prisma's schema language.

## Known Drift Issues

### 1. pgvector IVFFlat Index (idx_memories_embedding)

**Table:** `memories`
**Index:** `idx_memories_embedding`
**Type:** IVFFlat (Inverted File with Flat compression)

```sql
CREATE INDEX "idx_memories_embedding" ON "memories"
USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50);
```

**Why IVFFlat instead of HNSW:**

- HNSW has higher memory consumption during index building
- IVFFlat is more memory-efficient for our dataset size
- Both provide approximate nearest neighbor search

**Why Prisma can't represent it:**

- The `embedding` column uses `Unsupported("vector")` type
- Prisma's index support for `Unsupported` types is limited
- Until Prisma adds first-class pgvector support, this index must be managed manually

**If accidentally dropped:**

- Vector similarity search will fall back to sequential scan (extremely slow)
- Rebuild with: `CREATE INDEX "idx_memories_embedding" ON "memories" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50);`

### 2. Partial Index on chunk_group_id (memories_chunk_group_id_idx)

**Table:** `memories`
**Index:** `memories_chunk_group_id_idx`
**Type:** Partial B-tree index

```sql
CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id")
WHERE "chunk_group_id" IS NOT NULL;
```

**Why Prisma can't represent it:**

- Prisma's `@@index` directive doesn't support `WHERE` clauses for partial indexes
- The schema declares `@@index([chunkGroupId])` which would create a full index
- We manually created a partial index to save space (most memories aren't chunked)
- Prisma sees the partial index as "not matching" the schema and tries to "fix" it

**What happens without the fix:**

- Prisma generates `CREATE INDEX memories_chunk_group_id_idx` (without WHERE clause)
- This fails with "relation already exists" because the partial index has the same name
- Or if dropped first, creates an unnecessarily large index

**If accidentally modified:**

```sql
-- Drop the wrong index and recreate properly
DROP INDEX IF EXISTS "memories_chunk_group_id_idx";
CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id")
WHERE "chunk_group_id" IS NOT NULL;
```

### 3. GIN Index on JSONB (RESOLVED)

**Status:** Fixed in schema as of 2025-12-13

The GIN index on `conversation_history.message_metadata` is now properly defined in the schema:

```prisma
@@index([messageMetadata], map: "conversation_history_message_metadata_idx", type: Gin)
```

This was previously a drift issue but Prisma 6+ supports GIN indexes natively.

## Recommended Workflow

### Creating New Migrations (Preferred Method)

Use the safe migration script which automatically sanitizes drift patterns:

```bash
pnpm --filter @tzurot/scripts run db:migrate:safe -- <migration_name>
```

This script:

1. Runs `prisma migrate dev --create-only`
2. Scans the generated SQL for known drift patterns
3. Removes dangerous DROP/CREATE statements automatically
4. Reports what was sanitized
5. Shows you the final migration for review

### Manual Migration Creation

If you need to run Prisma directly:

1. **Inspect current state first:**

   ```bash
   pnpm --filter @tzurot/scripts run db:inspect
   ```

2. **Create the migration:**

   ```bash
   npx prisma migrate dev --create-only --name <name>
   ```

3. **Review the generated SQL** - Look for:
   - `DROP INDEX "idx_memories_embedding"` - REMOVE THIS
   - `DROP INDEX "memories_chunk_group_id_idx"` - REMOVE THIS
   - `CREATE INDEX "memories_chunk_group_id_idx"` without WHERE clause - REMOVE THIS

4. **Apply the sanitized migration:**
   ```bash
   npx prisma migrate dev
   ```

### Handling Failed Migrations

If a migration fails mid-way:

```bash
# Check migration status
npx prisma migrate status

# Mark as rolled back (if you cleaned up manually)
npx prisma migrate resolve --rolled-back "<migration_name>"

# Or mark as applied (if it actually succeeded)
npx prisma migrate resolve --applied "<migration_name>"
```

### Recovering Protected Indexes

If critical indexes were accidentally dropped:

```bash
# Connect to database and recreate
DATABASE_URL="..." npx prisma db execute --stdin <<SQL
-- HNSW vector index
CREATE INDEX IF NOT EXISTS "idx_memories_embedding"
ON "memories" USING hnsw ("embedding" vector_cosine_ops);

-- Partial index for chunk groups
DROP INDEX IF EXISTS "memories_chunk_group_id_idx";
CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id")
WHERE "chunk_group_id" IS NOT NULL;
SQL
```

## Configuration

Drift patterns are defined in `prisma/drift-ignore.json`:

```json
{
  "protectedIndexes": [...],
  "ignorePatterns": [
    {
      "pattern": "DROP INDEX.*idx_memories_embedding",
      "reason": "HNSW index cannot be represented in Prisma schema",
      "action": "remove"
    }
  ]
}
```

When adding new protected indexes, update both this document AND `drift-ignore.json`.

## Prevention Checklist

When creating new indexes that Prisma can't represent:

1. Add a comment in `schema.prisma` referencing this document
2. Add an entry to the **Known Drift Issues** section above
3. Add the pattern to `prisma/drift-ignore.json`
4. Consider if Prisma can represent it (check latest Prisma docs for new features)
5. Document the recreation command in case of accidental deletion

## Related Resources

- [Prisma PostgreSQL Extensions](https://www.prisma.io/docs/concepts/database-connectors/postgresql#postgresql-extensions)
- [pgvector GitHub](https://github.com/pgvector/pgvector)
- [tzurot-db-vector skill](.claude/skills/tzurot-db-vector/SKILL.md) - Database patterns including vector operations
- `prisma/drift-ignore.json` - Machine-readable drift configuration
