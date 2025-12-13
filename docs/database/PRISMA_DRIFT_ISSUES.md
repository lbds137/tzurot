# Prisma Schema Drift Issues

This document tracks known cases where the database state intentionally differs from what Prisma can represent in `schema.prisma`. When running `prisma migrate dev --create-only`, Prisma may generate DROP statements for these items - **do not apply those drops**.

## Background

Prisma uses the schema as the source of truth. When it detects database objects that aren't in the schema, it considers this "drift" and generates migrations to remove them. However, some PostgreSQL features cannot be represented in Prisma's schema language.

## Known Drift Issues

### 1. pgvector HNSW Index (idx_memories_embedding)

**Table:** `memories`
**Index:** `idx_memories_embedding`
**Type:** HNSW (Hierarchical Navigable Small World)

```sql
CREATE INDEX "idx_memories_embedding" ON "memories"
USING hnsw ("embedding" vector_cosine_ops);
```

**Why Prisma can't represent it:**

- The `embedding` column uses `Unsupported("vector")` type
- Prisma's HNSW index support (`type: Hnsw`, `ops: VectorCosineOps`) only works with native vector types, not `Unsupported` types
- Until Prisma adds first-class pgvector support, this index must be managed manually

**If accidentally dropped:**

- Vector similarity search will fall back to sequential scan (extremely slow)
- Rebuild with: `CREATE INDEX "idx_memories_embedding" ON "memories" USING hnsw ("embedding" vector_cosine_ops);`
- Note: Rebuilding HNSW indexes on large datasets is computationally expensive

### 2. GIN Index on JSONB (RESOLVED)

**Status:** Fixed in schema as of 2025-12-13

The GIN index on `conversation_history.message_metadata` is now properly defined in the schema:

```prisma
@@index([messageMetadata], map: "conversation_history_message_metadata_idx", type: Gin)
```

This was previously a drift issue but Prisma 6+ supports GIN indexes natively.

## How to Handle Drift in Migrations

When running `prisma migrate dev --create-only`:

1. **Always review the generated SQL** before applying
2. **Look for DROP INDEX statements** at the top of the migration
3. **Remove any DROP statements** for indexes listed above
4. **Verify the migration** only contains your intended changes

Example of what to remove:

```sql
-- REMOVE THIS LINE if you see it:
DROP INDEX "idx_memories_embedding";
```

## Prevention Checklist

When creating new indexes that Prisma can't represent:

1. Add a comment in `schema.prisma` referencing this document
2. Add an entry to this document explaining the index
3. Consider if Prisma can represent it (check latest Prisma docs for new features)
4. Document the recreation command in case of accidental deletion

## Related Resources

- [Prisma PostgreSQL Extensions](https://www.prisma.io/docs/concepts/database-connectors/postgresql#postgresql-extensions)
- [pgvector GitHub](https://github.com/pgvector/pgvector)
- [tzurot-db-vector skill](.claude/skills/tzurot-db-vector/SKILL.md) - Database patterns including vector operations
