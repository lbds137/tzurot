-- Consolidate legacy LLM config columns into advancedParameters JSONB
-- This is a data migration that merges existing column values into the JSONB field.
-- Legacy columns are NOT dropped - they will be removed in a future migration after stability is confirmed.

-- Step 1: Merge legacy columns into advancedParameters for rows that have legacy data
-- but either no advancedParameters or empty advancedParameters
UPDATE "llm_configs"
SET "advanced_parameters" = jsonb_strip_nulls(
  COALESCE("advanced_parameters", '{}'::jsonb) || jsonb_build_object(
    'temperature', "temperature",
    'top_p', "top_p",
    'top_k', "top_k",
    'frequency_penalty', "frequency_penalty",
    'presence_penalty', "presence_penalty",
    'repetition_penalty', "repetition_penalty",
    'max_tokens', "max_tokens"
  )
)
WHERE (
  "temperature" IS NOT NULL OR
  "top_p" IS NOT NULL OR
  "top_k" IS NOT NULL OR
  "frequency_penalty" IS NOT NULL OR
  "presence_penalty" IS NOT NULL OR
  "repetition_penalty" IS NOT NULL OR
  "max_tokens" IS NOT NULL
);

-- Add comment to schema documenting the legacy columns
COMMENT ON COLUMN "llm_configs"."temperature" IS '@deprecated Migrated to advanced_parameters JSONB. Do not use in new code.';
COMMENT ON COLUMN "llm_configs"."top_p" IS '@deprecated Migrated to advanced_parameters JSONB. Do not use in new code.';
COMMENT ON COLUMN "llm_configs"."top_k" IS '@deprecated Migrated to advanced_parameters JSONB. Do not use in new code.';
COMMENT ON COLUMN "llm_configs"."frequency_penalty" IS '@deprecated Migrated to advanced_parameters JSONB. Do not use in new code.';
COMMENT ON COLUMN "llm_configs"."presence_penalty" IS '@deprecated Migrated to advanced_parameters JSONB. Do not use in new code.';
COMMENT ON COLUMN "llm_configs"."repetition_penalty" IS '@deprecated Migrated to advanced_parameters JSONB. Do not use in new code.';
COMMENT ON COLUMN "llm_configs"."max_tokens" IS '@deprecated Migrated to advanced_parameters JSONB. Do not use in new code.';
