-- Add token_count column to conversation_history for performance optimization
--
-- This optimization caches token counts to avoid recomputing them on every AI request.
-- Token counting with tiktoken has overhead, and conversation history can be 100+ messages.
-- Computing once during storage and reusing is much more efficient.
--
-- NULL values indicate old messages that haven't been backfilled yet.
-- The code will compute tokens on-the-fly for NULL values and could optionally backfill.

ALTER TABLE "conversation_history" ADD COLUMN "token_count" INTEGER;
