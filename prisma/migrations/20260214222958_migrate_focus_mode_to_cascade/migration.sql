-- Data Migration: Copy focusModeEnabled into configOverrides JSONB
--
-- Backfills UserPersonalityConfig rows where focusModeEnabled = true
-- into the configOverrides JSONB column for cascade consistency.
--
-- The focusModeEnabled column is kept for now (dual-read during transition).
-- MemoryRetriever already prefers cascade: configOverrides?.focusModeEnabled ?? personaResult.focusModeEnabled
--
-- Only rows with focusModeEnabled = true need migration (false is the default).
-- Merge semantics: existing configOverrides values take precedence.

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- CreateIndex
-- REMOVED: CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id");

-- ============================================================================
-- Backfill focusModeEnabled = true into configOverrides JSONB
-- ============================================================================
UPDATE user_personality_configs
SET
  config_overrides = CASE
    WHEN config_overrides IS NULL THEN '{"focusModeEnabled": true}'::jsonb
    ELSE '{"focusModeEnabled": true}'::jsonb || config_overrides
  END,
  updated_at = NOW()
WHERE focus_mode_enabled = true;
