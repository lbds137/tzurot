-- Memory Management Phase 2: Add fields for focus mode, memory locking, and visibility
-- See: docs/proposals/active/MEMORY_MANAGEMENT_COMMANDS.md

-- Add focus mode toggle to user_personality_configs
-- When enabled, LTM retrieval is disabled (memories still saved, just not retrieved)
ALTER TABLE "user_personality_configs"
ADD COLUMN "focus_mode_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Add memory management fields to memories table
-- is_locked: Protected "core memories" that survive batch/purge operations
-- visibility: Future use for hiding/archiving memories
-- updated_at: Track when memory content was last modified
ALTER TABLE "memories"
ADD COLUMN "is_locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "visibility" VARCHAR(20) NOT NULL DEFAULT 'normal',
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Partial index for efficient locked memory queries
-- Only indexes rows where is_locked = true (sparse index)
CREATE INDEX "idx_memories_is_locked" ON "memories"("is_locked") WHERE "is_locked" = true;

-- Index for visibility filtering
CREATE INDEX "idx_memories_visibility" ON "memories"("visibility");
