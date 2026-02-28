/*
  Warnings:

  - You are about to drop the column `share_ltm_across_personalities` on the `personas` table. All the data in the column will be lost.

*/
-- DropIndex
-- REMOVED: DROP INDEX "llm_configs_free_default_unique";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_is_locked";

-- DropIndex
-- REMOVED: DROP INDEX "memories_chunk_group_id_idx";

-- Data Migration: Move share_ltm_across_personalities=true into the owner User's config_defaults JSONB
-- For each persona with sharing enabled, merge {"shareLtmAcrossPersonalities": true} into the
-- user's config_defaults (creating the JSONB if null). Uses the persona owner's user record.
--
-- Semantic note: This uses OR semantics — if ANY of a user's personas had sharing enabled,
-- the user gets sharing enabled globally via config_defaults. This is intentional: the setting
-- is now per-user (config cascade) rather than per-persona, and a user who opted into sharing
-- on any persona presumably prefers sharing behavior.
UPDATE "users" u
SET "config_defaults" = COALESCE(u."config_defaults", '{}'::jsonb) || '{"shareLtmAcrossPersonalities": true}'::jsonb
FROM "personas" p
WHERE p."owner_id" = u."id"
  AND p."share_ltm_across_personalities" = true;

-- AlterTable
ALTER TABLE "personas" DROP COLUMN "share_ltm_across_personalities";

-- CreateIndex
-- REMOVED: CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id");
