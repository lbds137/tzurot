-- Remove unused epoch fields from user_personality_configs
-- These fields were never used; epoch tracking lives in user_persona_history_configs
-- See: docs/postmortems/PROJECT_POSTMORTEMS.md for context

ALTER TABLE "user_personality_configs" DROP COLUMN IF EXISTS "last_context_reset";
ALTER TABLE "user_personality_configs" DROP COLUMN IF EXISTS "previous_context_reset";
