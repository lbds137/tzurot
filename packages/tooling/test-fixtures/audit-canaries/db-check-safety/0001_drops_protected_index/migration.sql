-- Canary migration: deliberate violation of the protected-index rule.
--
-- This migration MUST be flagged by `pnpm ops db:check-safety` — it drops
-- the IVFFlat index that backs pgvector similarity search without
-- recreating it. If the canary test ever passes against this file showing
-- 0 violations, the tool is broken (silently misconfigured, reading from
-- the wrong path, or its regex no longer matches the production index
-- name).
--
-- DO NOT FIX this migration. DO NOT REMOVE THIS FILE. It is intentional.

DROP INDEX "idx_memories_embedding";
