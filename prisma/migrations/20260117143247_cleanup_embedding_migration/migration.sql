-- Cleanup Migration: Complete OpenAI to Local BGE Embedding Transition
--
-- This migration finalizes the embedding column migration:
-- - Removes the old OpenAI embedding column (1536 dimensions)
-- - Renames embedding_local to embedding (384 dimensions, BGE-small-en-v1.5)
-- - Recreates the index with the standard name
--
-- Prerequisites:
-- 1. All memories must have embedding_local populated (run backfill first!)
-- 2. All code must be using embedding_local (already done in PR #473)
--
-- IMPORTANT: This migration is NOT reversible without re-generating OpenAI embeddings.

-- Step 1: Drop the old OpenAI embedding index
-- (Must drop index before dropping column it references)
DROP INDEX IF EXISTS "idx_memories_embedding";

-- Step 2: Drop the old OpenAI embedding column (1536 dimensions)
-- This removes the deprecated column that's no longer used
ALTER TABLE "memories" DROP COLUMN IF EXISTS "embedding";

-- Step 3: Drop the local embedding index (will recreate with standard name)
DROP INDEX IF EXISTS "idx_memories_embedding_local";

-- Step 4: Rename embedding_local to embedding
-- This makes the local BGE embedding the primary embedding column
ALTER TABLE "memories" RENAME COLUMN "embedding_local" TO "embedding";

-- Step 5: Recreate the index with the standard name
-- IVFFlat index for BGE-small-en-v1.5 (384 dimensions)
CREATE INDEX "idx_memories_embedding" ON "memories" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50);
