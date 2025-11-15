-- Convert discord_message_id from nullable VARCHAR(20) to TEXT[] (array)
-- This migration preserves existing data by converting:
--   NULL -> [] (empty array)
--   'existing_id' -> ['existing_id'] (single-element array)

-- ===========================================================================
-- ROLLBACK INSTRUCTIONS (if migration needs to be reverted):
-- ===========================================================================
-- WARNING: Rollback will lose data if any row has multiple Discord message IDs.
-- Only the FIRST ID in each array will be preserved.
--
-- -- Step 1: Drop GIN index
-- DROP INDEX IF EXISTS "conversation_history_discord_message_id_idx";
--
-- -- Step 2: Rename array column to temporary name
-- ALTER TABLE "conversation_history" RENAME COLUMN "discord_message_id" TO "discord_message_id_old";
--
-- -- Step 3: Create new scalar column (nullable VARCHAR(20))
-- ALTER TABLE "conversation_history" ADD COLUMN "discord_message_id" VARCHAR(20);
--
-- -- Step 4: Convert array data back to scalar (take first element, NULL if empty)
-- UPDATE "conversation_history"
-- SET "discord_message_id" = CASE
--   WHEN array_length("discord_message_id_old", 1) > 0 THEN "discord_message_id_old"[1]
--   ELSE NULL
-- END;
--
-- -- Step 5: Drop the array column
-- ALTER TABLE "conversation_history" DROP COLUMN "discord_message_id_old";
--
-- -- Step 6: Recreate the original B-tree index
-- CREATE INDEX "conversation_history_discord_message_id_idx" ON "conversation_history"("discord_message_id");
-- ===========================================================================

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
