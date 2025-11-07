-- Convert discord_message_id from nullable VARCHAR(20) to TEXT[] (array)
-- This migration preserves existing data by converting:
--   NULL -> [] (empty array)
--   'existing_id' -> ['existing_id'] (single-element array)

-- Step 1: Create new array column
ALTER TABLE "conversation_history" ADD COLUMN "discord_message_id_new" TEXT[] NOT NULL DEFAULT '{}';

-- Step 2: Convert existing data
-- If old column has a value, wrap it in an array. Otherwise, use empty array.
UPDATE "conversation_history"
SET "discord_message_id_new" = CASE
  WHEN "discord_message_id" IS NOT NULL THEN ARRAY["discord_message_id"]
  ELSE '{}'
END;

-- Step 3: Drop the old column (and its index)
DROP INDEX IF EXISTS "conversation_history_discord_message_id_idx";
ALTER TABLE "conversation_history" DROP COLUMN "discord_message_id";

-- Step 4: Rename new column to original name
ALTER TABLE "conversation_history" RENAME COLUMN "discord_message_id_new" TO "discord_message_id";

-- Step 5: Recreate the index (PostgreSQL supports indexing on arrays using GIN)
CREATE INDEX "conversation_history_discord_message_id_idx" ON "conversation_history" USING GIN ("discord_message_id");
