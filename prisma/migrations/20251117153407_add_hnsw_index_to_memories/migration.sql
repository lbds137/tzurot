-- CreateIndex
-- HNSW (Hierarchical Navigable Small World) index for fast vector similarity search
-- Parameters:
--   m = 16: Number of connections per layer (higher = better recall, more memory)
--   ef_construction = 64: Size of dynamic candidate list (higher = better quality, slower build)
--   vector_cosine_ops: Use cosine distance for similarity (1 - cosine similarity)
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
