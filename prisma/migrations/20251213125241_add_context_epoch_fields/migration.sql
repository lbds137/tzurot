-- AlterTable
-- Add STM Epoch System fields for non-destructive conversation history filtering
-- Messages older than last_context_reset are excluded from AI context
-- See ADR-003 in docs/planning/SLASH_COMMAND_ARCHITECTURE.md
ALTER TABLE "user_personality_configs" ADD COLUMN "last_context_reset" TIMESTAMP(3);
ALTER TABLE "user_personality_configs" ADD COLUMN "previous_context_reset" TIMESTAMP(3);
