-- CreateIndex
-- NOTE: Originally planned to use HNSW, but Railway dev database has insufficient shared memory.
-- Using IVFFlat instead - still provides fast vector similarity search with lower memory requirements.
--
-- IVFFlat (Inverted File with Flat Compression) index for vector similarity search
-- Parameters:
--   lists = 100: Number of inverted lists (higher = more accurate, slower queries)
--   vector_cosine_ops: Use cosine distance for similarity (1 - cosine similarity)
--
-- Performance: ~10-50x faster than sequential scan, slightly slower than HNSW but much easier to build
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
