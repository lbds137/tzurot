-- PR Review Fixes: Add missing indexes and constraints

-- Fix Critical #2: Enforce only one LlmConfig can have is_free_default = true
-- This partial unique index only applies to rows where is_free_default is true
-- Prevents data integrity issues where multiple configs could be marked as free default
CREATE UNIQUE INDEX "llm_configs_free_default_unique"
  ON "llm_configs"("is_free_default")
  WHERE "is_free_default" = true;

-- Fix Major #6: Add standalone provider index on user_api_keys
-- Queries in ApiKeyResolver filter by provider, this improves performance at scale
CREATE INDEX "user_api_keys_provider_idx" ON "user_api_keys"("provider");
