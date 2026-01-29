-- Make owner_id NOT NULL on llm_configs and personalities
--
-- SAFETY VERIFICATION (run before migration to confirm no NULL owners):
--   SELECT COUNT(*) FROM llm_configs WHERE owner_id IS NULL;    -- Should return 0
--   SELECT COUNT(*) FROM personalities WHERE owner_id IS NULL;  -- Should return 0
--
-- BEHAVIORAL CHANGE:
--   personalities.owner: onDelete changed from SetNull to Cascade
--   Before: Deleting a user would orphan their personalities (set owner_id = NULL)
--   After: Deleting a user deletes all their personalities
--   This is intentional - orphaned entities without owners don't make sense

-- LlmConfig: make owner_id required (FK already has ON DELETE CASCADE)
ALTER TABLE "llm_configs" ALTER COLUMN "owner_id" SET NOT NULL;

-- Personality: make owner_id required AND update FK constraint from SET NULL to CASCADE
ALTER TABLE "personalities" ALTER COLUMN "owner_id" SET NOT NULL;

-- Update FK constraint: change ON DELETE behavior from SET NULL to CASCADE
-- First drop the existing constraint, then recreate with CASCADE
ALTER TABLE "personalities" DROP CONSTRAINT "personalities_owner_id_fkey";
ALTER TABLE "personalities" ADD CONSTRAINT "personalities_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
