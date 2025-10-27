-- AlterTable
ALTER TABLE "llm_configs" ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false;

-- Create partial unique index to ensure only one default LLM config
-- This allows multiple false values but only one true value
CREATE UNIQUE INDEX unique_default_llm_config ON llm_configs (is_default) WHERE is_default = true;
