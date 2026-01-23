-- Drop legacy LLM config columns that have been migrated to advancedParameters JSONB
-- These columns were migrated in 20260119113200_consolidate_llm_config_params
-- and are no longer read by any application code.

-- Drop the deprecated columns
ALTER TABLE "llm_configs" DROP COLUMN IF EXISTS "temperature";
ALTER TABLE "llm_configs" DROP COLUMN IF EXISTS "top_p";
ALTER TABLE "llm_configs" DROP COLUMN IF EXISTS "top_k";
ALTER TABLE "llm_configs" DROP COLUMN IF EXISTS "frequency_penalty";
ALTER TABLE "llm_configs" DROP COLUMN IF EXISTS "presence_penalty";
ALTER TABLE "llm_configs" DROP COLUMN IF EXISTS "repetition_penalty";
ALTER TABLE "llm_configs" DROP COLUMN IF EXISTS "max_tokens";
