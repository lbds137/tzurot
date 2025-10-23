-- Schema Redesign: Remove Circular Foreign Keys
-- This migration removes circular dependencies between User and Persona,
-- and between Personality and LlmConfig, by using separate tracking tables.

-- =============================================================================
-- STEP 1: Create new tracking tables
-- =============================================================================

-- UserDefaultPersona: Tracks each user's default persona (no circular dependency)
CREATE TABLE "user_default_personas" (
    "user_id" UUID NOT NULL,
    "persona_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_default_personas_pkey" PRIMARY KEY ("user_id")
);

CREATE UNIQUE INDEX "user_default_personas_user_id_key" ON "user_default_personas"("user_id");
CREATE INDEX "user_default_personas_persona_id_idx" ON "user_default_personas"("persona_id");

-- PersonalityDefaultConfig: Tracks each personality's default LLM config (no circular dependency)
CREATE TABLE "personality_default_configs" (
    "personality_id" UUID NOT NULL,
    "llm_config_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personality_default_configs_pkey" PRIMARY KEY ("personality_id")
);

CREATE UNIQUE INDEX "personality_default_configs_personality_id_key" ON "personality_default_configs"("personality_id");
CREATE INDEX "personality_default_configs_llm_config_id_idx" ON "personality_default_configs"("llm_config_id");

-- UserPersonalityConfig: Rename from UserPersonalitySettings (same structure, clearer name)
CREATE TABLE "user_personality_configs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "personality_id" UUID NOT NULL,
    "persona_id" UUID,
    "llm_config_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_personality_configs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_personality_configs_user_id_idx" ON "user_personality_configs"("user_id");
CREATE INDEX "user_personality_configs_personality_id_idx" ON "user_personality_configs"("personality_id");
CREATE UNIQUE INDEX "user_personality_configs_user_id_personality_id_key" ON "user_personality_configs"("user_id", "personality_id");

-- =============================================================================
-- STEP 2: Add new columns to existing tables (BEFORE migrating data!)
-- =============================================================================

-- LlmConfig: Add contextWindowSize, isGlobal, ownerId
ALTER TABLE "llm_configs"
  ADD COLUMN IF NOT EXISTS "context_window_size" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "is_global" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "owner_id" UUID;

-- =============================================================================
-- STEP 3: Migrate data from old columns to new tables/columns
-- =============================================================================

-- Migrate User.globalPersonaId -> UserDefaultPersona
INSERT INTO "user_default_personas" ("user_id", "persona_id", "updated_at")
SELECT "id", "global_persona_id", NOW()
FROM "users"
WHERE "global_persona_id" IS NOT NULL;

-- Migrate Personality.llmConfigId -> PersonalityDefaultConfig
INSERT INTO "personality_default_configs" ("personality_id", "llm_config_id", "updated_at")
SELECT "id", "llm_config_id", NOW()
FROM "personalities"
WHERE "llm_config_id" IS NOT NULL;

-- Migrate Personality.contextWindowSize -> LlmConfig.contextWindowSize
-- For each personality, update its linked LLM config with the personality's context window size
UPDATE "llm_configs" llm
SET "context_window_size" = p."context_window_size"
FROM "personalities" p
WHERE llm."id" = p."llm_config_id"
  AND p."llm_config_id" IS NOT NULL
  AND p."context_window_size" IS NOT NULL;

-- Migrate UserPersonalitySettings -> UserPersonalityConfig (same data, renamed table)
INSERT INTO "user_personality_configs" ("id", "user_id", "personality_id", "persona_id", "llm_config_id", "created_at", "updated_at")
SELECT "id", "user_id", "personality_id", "persona_id", "llm_config_id", "created_at", "updated_at"
FROM "user_personality_settings";

-- =============================================================================
-- STEP 4: Handle constraints (Persona.ownerId NOT NULL)
-- =============================================================================

-- Set ownerId to first user if NULL (should not happen, but safety check)
UPDATE "personas"
SET "owner_id" = (SELECT "id" FROM "users" ORDER BY "created_at" LIMIT 1)
WHERE "owner_id" IS NULL;

-- =============================================================================
-- STEP 5: Drop old foreign keys
-- =============================================================================

ALTER TABLE "public"."personalities" DROP CONSTRAINT IF EXISTS "personalities_llm_config_id_fkey";
ALTER TABLE "public"."user_personality_settings" DROP CONSTRAINT IF EXISTS "user_personality_settings_llm_config_id_fkey";
ALTER TABLE "public"."user_personality_settings" DROP CONSTRAINT IF EXISTS "user_personality_settings_persona_id_fkey";
ALTER TABLE "public"."user_personality_settings" DROP CONSTRAINT IF EXISTS "user_personality_settings_personality_id_fkey";
ALTER TABLE "public"."user_personality_settings" DROP CONSTRAINT IF EXISTS "user_personality_settings_user_id_fkey";
ALTER TABLE "public"."users" DROP CONSTRAINT IF EXISTS "users_global_persona_id_fkey";

-- =============================================================================
-- STEP 6: Drop old indexes
-- =============================================================================

DROP INDEX IF EXISTS "public"."idx_llm_configs_default";
DROP INDEX IF EXISTS "public"."idx_personas_global";

-- =============================================================================
-- STEP 7: Drop old columns
-- =============================================================================

-- LlmConfig: Remove isDefault (not used in new schema)
ALTER TABLE "llm_configs" DROP COLUMN IF EXISTS "is_default";

-- Personality: Remove contextWindowSize and llmConfigId (moved to tables/LlmConfig)
ALTER TABLE "personalities"
  DROP COLUMN IF EXISTS "context_window_size",
  DROP COLUMN IF EXISTS "llm_config_id";

-- Persona: Remove isGlobal, make ownerId NOT NULL
ALTER TABLE "personas"
  DROP COLUMN IF EXISTS "is_global",
  ALTER COLUMN "owner_id" SET NOT NULL;

-- User: Remove globalPersonaId (moved to UserDefaultPersona)
ALTER TABLE "users" DROP COLUMN IF EXISTS "global_persona_id";

-- =============================================================================
-- STEP 8: Drop old table
-- =============================================================================

DROP TABLE IF EXISTS "public"."user_personality_settings";

-- =============================================================================
-- STEP 9: Create new indexes
-- =============================================================================

CREATE INDEX "llm_configs_owner_id_idx" ON "llm_configs"("owner_id");
CREATE INDEX "llm_configs_is_global_idx" ON "llm_configs"("is_global");

-- =============================================================================
-- STEP 10: Add foreign keys for new tables
-- =============================================================================

ALTER TABLE "user_default_personas"
  ADD CONSTRAINT "user_default_personas_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_default_personas"
  ADD CONSTRAINT "user_default_personas_persona_id_fkey"
  FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "llm_configs"
  ADD CONSTRAINT "llm_configs_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "personality_default_configs"
  ADD CONSTRAINT "personality_default_configs_personality_id_fkey"
  FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "personality_default_configs"
  ADD CONSTRAINT "personality_default_configs_llm_config_id_fkey"
  FOREIGN KEY ("llm_config_id") REFERENCES "llm_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_personality_configs"
  ADD CONSTRAINT "user_personality_configs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_personality_configs"
  ADD CONSTRAINT "user_personality_configs_personality_id_fkey"
  FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_personality_configs"
  ADD CONSTRAINT "user_personality_configs_persona_id_fkey"
  FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_personality_configs"
  ADD CONSTRAINT "user_personality_configs_llm_config_id_fkey"
  FOREIGN KEY ("llm_config_id") REFERENCES "llm_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- STEP 11: Fix index naming (Prisma convention)
-- =============================================================================

ALTER INDEX IF EXISTS "idx_system_prompts_default" RENAME TO "system_prompts_is_default_idx";
