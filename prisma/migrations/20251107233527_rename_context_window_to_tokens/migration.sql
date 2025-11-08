-- Rename context_window_size to context_window_tokens and convert values from message counts to token budgets
-- This migration converts from counting messages to counting tokens for more accurate context management

-- Step 1: Add new column with token-based default (128k tokens)
ALTER TABLE "llm_configs" ADD COLUMN "context_window_tokens" INTEGER NOT NULL DEFAULT 131072;

-- Step 2: Convert existing values from message counts to token estimates
-- For existing configs, we'll use sensible token defaults based on typical model capabilities
-- Old default was 20 messages (~10k tokens), new default is 128k tokens
UPDATE "llm_configs" SET "context_window_tokens" = 131072;

-- Step 3: Drop the old column
ALTER TABLE "llm_configs" DROP COLUMN "context_window_size";
