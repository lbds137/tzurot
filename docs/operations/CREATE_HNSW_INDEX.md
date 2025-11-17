# Creating HNSW Index for Vector Similarity Search

**Status**: Pending execution (migration created but not applied due to memory constraints)
**Migration**: `20251117153407_add_hnsw_index_to_memories`
**Created**: 2025-11-17

## Problem

The `memories` table has vector embeddings but no index, causing slow similarity searches. Attempting to create the HNSW index failed with:

```
ERROR: could not resize shared memory segment "/PostgreSQL.2617323834" to 63999840 bytes:
No space left on device
```

This is a Railway/PostgreSQL shared memory limitation during index building.

## Solutions

### Option 1: Run During Off-Peak Hours (Recommended)

Index creation is memory-intensive. Run when database has fewer active connections:

```bash
# Using Railway CLI
railway run --service ai-worker psql $DATABASE_URL < scripts/create-hnsw-index.sql
```

### Option 2: Use Lower Memory Parameters

If Option 1 fails, use smaller index parameters (slightly less accurate but faster to build):

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_embedding ON memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 8, ef_construction = 32);
```

Parameters explained:
- **m = 8** (vs 16): Fewer connections per layer = less memory, slightly lower recall
- **ef_construction = 32** (vs 64): Smaller candidate list = less memory, faster build

### Option 3: Temporarily Increase Railway Resources

Contact Railway support or temporarily upgrade database tier for index creation.

### Option 4: Use IVFFlat Index Instead

If HNSW continues failing, use IVFFlat (simpler, less memory):

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_embedding ON memories
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

Note: IVFFlat is faster to build but slower at query time compared to HNSW.

## Verification

After successful index creation:

```sql
-- Check if index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'memories'
  AND indexname = 'idx_memories_embedding';

-- Check index size
SELECT pg_size_pretty(pg_relation_size('idx_memories_embedding'));

-- Test query performance (should be fast with index)
EXPLAIN ANALYZE
SELECT id, content, embedding <=> '[0.1, 0.2, ...]'::vector AS distance
FROM memories
WHERE personality_id = 'some-uuid'
ORDER BY distance
LIMIT 10;
```

## Cleanup After Success

Once index is created and verified:

1. Mark migration as applied in Prisma:
   ```bash
   npx prisma migrate resolve --applied 20251117153407_add_hnsw_index_to_memories
   ```

2. Delete this operations doc (info preserved in git history)

3. Delete `scripts/create-hnsw-index.sql` (migration file is canonical)

## Performance Impact

**Before Index** (sequential scan):
- Query time: O(n) - checks every vector
- ~100ms for 1,000 vectors
- ~1s for 10,000 vectors
- ~10s for 100,000 vectors

**After HNSW Index**:
- Query time: O(log n) - navigates graph
- ~10-50ms regardless of total vectors
- 10-100x faster for large datasets

## Current Status

- [x] Migration file created
- [ ] Index created in database
- [ ] Migration marked as applied
- [ ] Performance verified

## References

- [pgvector HNSW Documentation](https://github.com/pgvector/pgvector#hnsw)
- [PostgreSQL Shared Memory](https://www.postgresql.org/docs/current/kernel-resources.html)
- Migration: `prisma/migrations/20251117153407_add_hnsw_index_to_memories/migration.sql`
