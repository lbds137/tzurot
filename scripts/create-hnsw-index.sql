-- Create HNSW index for vector similarity search on memories table
-- Run this script during off-peak hours as index creation is memory-intensive

-- Check memory count first
SELECT
    COUNT(*) as total_memories,
    COUNT(embedding) as memories_with_embeddings
FROM memories;

-- Option 1: Standard parameters (recommended, requires more memory)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_embedding ON memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- If Option 1 fails with "No space left on device", use Option 2:
-- DROP INDEX IF EXISTS idx_memories_embedding;

-- Option 2: Lower memory parameters (faster creation, slightly less accurate)
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_embedding ON memories
--   USING hnsw (embedding vector_cosine_ops)
--   WITH (m = 8, ef_construction = 32);

-- Verify index creation
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'memories'
  AND indexname = 'idx_memories_embedding';
