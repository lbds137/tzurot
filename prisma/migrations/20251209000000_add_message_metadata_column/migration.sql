-- Add message_metadata JSONB column to conversation_history
-- This stores structured metadata (referenced messages, attachments) separate from content
-- Enables clean separation of semantic content from contextual data

ALTER TABLE "conversation_history" ADD COLUMN "message_metadata" JSONB DEFAULT '{}';

-- Add GIN index for efficient JSONB queries (e.g., finding all messages with references)
CREATE INDEX "conversation_history_message_metadata_idx" ON "conversation_history" USING GIN ("message_metadata");
