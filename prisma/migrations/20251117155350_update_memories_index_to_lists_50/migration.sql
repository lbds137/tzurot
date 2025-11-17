-- Drop existing index (may have lists=100 on dev, lists=50 on prod)
DROP INDEX IF EXISTS idx_memories_embedding;

-- Recreate with lists=50 to fit Railway's 64 MB maintenance_work_mem limit
-- IVFFlat (Inverted File with Flat Compression) index for vector similarity search
-- Parameters:
--   lists = 50: Number of inverted lists (reduced from 100 for memory constraints)
--   vector_cosine_ops: Use cosine distance for similarity (1 - cosine similarity)
--
-- Performance: ~10-50x faster than sequential scan
-- Memory: Fits within Railway's maintenance_work_mem limit (64 MB)
CREATE INDEX idx_memories_embedding ON memories
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);
