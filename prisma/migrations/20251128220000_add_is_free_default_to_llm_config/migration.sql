-- Add is_free_default column for guest mode (users without API keys)
-- Only one LlmConfig should have is_free_default = true at a time
ALTER TABLE "llm_configs" ADD COLUMN "is_free_default" BOOLEAN NOT NULL DEFAULT false;

-- Create index for efficient queries
CREATE INDEX "llm_configs_is_free_default_idx" ON "llm_configs"("is_free_default");
