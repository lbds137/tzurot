-- Drop unique constraints on boolean fields (can only have 2 records: true and false)
-- Replace with regular indexes for performance

-- Drop unique constraint on system_prompts.is_default
DROP INDEX IF EXISTS "idx_system_prompts_default";
CREATE INDEX IF NOT EXISTS "idx_system_prompts_default" ON "system_prompts"("is_default");

-- Drop unique constraint on llm_configs.is_default
DROP INDEX IF EXISTS "idx_llm_configs_default";
CREATE INDEX IF NOT EXISTS "idx_llm_configs_default" ON "llm_configs"("is_default");
