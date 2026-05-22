-- Surfaced by `pnpm ops dev:schema-audit` (the always-passed-no-default recipe):
-- both production writers (LlmConfigService.create + ShapesImportHelpers.upsert)
-- already pass these via `?? LLM_CONFIG_DEFAULTS.<field>` fallbacks, so the
-- DB-nullable shape is dead defensive code. Move the defaults into the schema
-- (single source of truth) and tighten to NOT NULL so direct-SQL writes can't
-- introduce nulls. The 0.5 / 20 values match
-- `packages/common-types/src/constants/ai.ts` AI_DEFAULTS.

-- Backfill any existing NULL rows with the canonical defaults before the
-- NOT NULL tightening below — safety net against any row that predates
-- LLM_CONFIG_DEFAULTS being added to the writers.
UPDATE "llm_configs" SET "memory_score_threshold" = 0.5 WHERE "memory_score_threshold" IS NULL;
UPDATE "llm_configs" SET "memory_limit" = 20 WHERE "memory_limit" IS NULL;

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- AlterTable
ALTER TABLE "llm_configs" ALTER COLUMN "memory_score_threshold" SET NOT NULL,
ALTER COLUMN "memory_score_threshold" SET DEFAULT 0.5,
ALTER COLUMN "memory_limit" SET NOT NULL,
ALTER COLUMN "memory_limit" SET DEFAULT 20;
