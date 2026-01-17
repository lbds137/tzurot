-- Add local embedding column for BGE-small-en-v1.5 (384 dimensions)
-- This is Phase 2a of the OpenAI Embedding Eviction plan.
--
-- Migration Strategy (Zero-Downtime):
-- Phase 2a: Add column (this migration)
-- Phase 2b: Dual-write (code change - write to both columns)
-- Phase 2c: Backfill existing memories
-- Phase 2d: Create index CONCURRENTLY
-- Phase 2e: Switch reads to new column
-- Phase 2f: Drop old column and index
--
-- NOTE: idx_memories_embedding (OpenAI 1536-dim) remains active during transition

-- Add the new column for local embeddings (384 dimensions)
ALTER TABLE "memories" ADD COLUMN "embedding_local" vector(384);
