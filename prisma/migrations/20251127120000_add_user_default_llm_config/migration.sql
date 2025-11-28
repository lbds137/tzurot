-- Add user default LLM config
-- Allows users to set a global default LLM config that applies to all personalities
-- unless they have a specific per-personality override

-- Add the foreign key column to users table
ALTER TABLE "users" ADD COLUMN "default_llm_config_id" UUID;

-- Add foreign key constraint
ALTER TABLE "users" ADD CONSTRAINT "users_default_llm_config_id_fkey"
  FOREIGN KEY ("default_llm_config_id")
  REFERENCES "llm_configs"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Add index for performance
CREATE INDEX "users_default_llm_config_id_idx" ON "users"("default_llm_config_id");

-- ============================================================================
-- ROLLBACK INSTRUCTIONS (manual - Prisma doesn't support down migrations)
-- ============================================================================
-- To rollback this migration, run the following SQL commands in order:
--
-- 1. Drop the index
--    DROP INDEX "users_default_llm_config_id_idx";
--
-- 2. Drop the foreign key constraint
--    ALTER TABLE "users" DROP CONSTRAINT "users_default_llm_config_id_fkey";
--
-- 3. Drop the column
--    ALTER TABLE "users" DROP COLUMN "default_llm_config_id";
--
-- 4. Remove the migration record from Prisma's tracking table
--    DELETE FROM "_prisma_migrations" WHERE migration_name = '20251127120000_add_user_default_llm_config';
-- ============================================================================
