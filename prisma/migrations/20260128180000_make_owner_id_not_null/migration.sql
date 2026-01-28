-- Make owner_id NOT NULL on llm_configs and personalities
-- All existing records already have owner_id set (verified before migration)

-- LlmConfig: make owner_id required
ALTER TABLE "llm_configs" ALTER COLUMN "owner_id" SET NOT NULL;

-- Personality: make owner_id required and change onDelete behavior
-- Previously onDelete: SetNull, now onDelete: Cascade (since NULL is no longer allowed)
ALTER TABLE "personalities" ALTER COLUMN "owner_id" SET NOT NULL;
