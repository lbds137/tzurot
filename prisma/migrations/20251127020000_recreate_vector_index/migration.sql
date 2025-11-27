-- Recreate vector index after it was incorrectly dropped
-- This index is essential for pgvector similarity search performance
CREATE INDEX IF NOT EXISTS idx_memories_embedding 
ON memories USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 50);
