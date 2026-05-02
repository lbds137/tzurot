-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- AlterTable
ALTER TABLE "user_personality_configs" ADD COLUMN     "tts_config_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "default_tts_config_id" UUID;

-- CreateTable
CREATE TABLE "tts_configs" (
    "id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "description" TEXT,
    "owner_id" UUID NOT NULL,
    "is_global" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_free_default" BOOLEAN NOT NULL DEFAULT false,
    "provider" VARCHAR(40) NOT NULL,
    "model_id" VARCHAR(255),
    "advanced_parameters" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tts_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personality_default_tts_configs" (
    "personality_id" UUID NOT NULL,
    "tts_config_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personality_default_tts_configs_pkey" PRIMARY KEY ("personality_id")
);

-- CreateIndex
CREATE INDEX "tts_configs_owner_id_idx" ON "tts_configs"("owner_id");

-- CreateIndex
CREATE INDEX "tts_configs_is_global_idx" ON "tts_configs"("is_global");

-- CreateIndex
CREATE INDEX "tts_configs_is_free_default_idx" ON "tts_configs"("is_free_default");

-- CreateIndex
CREATE UNIQUE INDEX "tts_configs_owner_id_name_key" ON "tts_configs"("owner_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "personality_default_tts_configs_personality_id_key" ON "personality_default_tts_configs"("personality_id");

-- CreateIndex
CREATE INDEX "personality_default_tts_configs_tts_config_id_idx" ON "personality_default_tts_configs"("tts_config_id");

-- CreateIndex
CREATE INDEX "users_default_tts_config_id_idx" ON "users"("default_tts_config_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_default_tts_config_id_fkey" FOREIGN KEY ("default_tts_config_id") REFERENCES "tts_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tts_configs" ADD CONSTRAINT "tts_configs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personality_default_tts_configs" ADD CONSTRAINT "personality_default_tts_configs_tts_config_id_fkey" FOREIGN KEY ("tts_config_id") REFERENCES "tts_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personality_default_tts_configs" ADD CONSTRAINT "personality_default_tts_configs_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_personality_configs" ADD CONSTRAINT "user_personality_configs_tts_config_id_fkey" FOREIGN KEY ("tts_config_id") REFERENCES "tts_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique index: at most ONE row in tts_configs may have is_free_default=true.
-- Prisma can't represent partial unique indexes natively (they're declared in
-- prisma/drift-ignore.json so the next migration won't try to drop this).
CREATE UNIQUE INDEX "tts_configs_free_default_unique"
  ON "tts_configs"("is_free_default")
  WHERE "is_free_default" = true;

-- ============================================================================
-- Seed: 3 system-global TtsConfigs
-- ----------------------------------------------------------------------------
-- Owned by the first superuser (the bot owner). isGlobal=true so they're
-- visible/usable by all users. The free-tier default points to kyutai-self-hosted.
-- If no superuser exists (fresh DB), the seed is skipped — application bootstrap
-- code is responsible for creating these on first-run instead.
-- ============================================================================
INSERT INTO "tts_configs" ("id", "name", "description", "owner_id", "is_global", "is_free_default", "provider", "model_id", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  'kyutai-self-hosted',
  'Self-hosted Kyutai/Pocket TTS — free tier default',
  (SELECT id FROM "users" WHERE is_superuser = true ORDER BY created_at LIMIT 1),
  true,
  true,
  'self-hosted',
  NULL,
  NOW(),
  NOW()
WHERE EXISTS (SELECT 1 FROM "users" WHERE is_superuser = true);

INSERT INTO "tts_configs" ("id", "name", "description", "owner_id", "is_global", "is_free_default", "provider", "model_id", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  'elevenlabs-multilingual-v2',
  'ElevenLabs Multilingual v2 — historic default for BYOK users',
  (SELECT id FROM "users" WHERE is_superuser = true ORDER BY created_at LIMIT 1),
  true,
  false,
  'elevenlabs',
  'eleven_multilingual_v2',
  NOW(),
  NOW()
WHERE EXISTS (SELECT 1 FROM "users" WHERE is_superuser = true);

INSERT INTO "tts_configs" ("id", "name", "description", "owner_id", "is_global", "is_free_default", "provider", "model_id", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  'mistral-voxtral-mini',
  'Mistral Voxtral Mini TTS — Phase 1 BYOK (~85% cost reduction vs ElevenLabs)',
  (SELECT id FROM "users" WHERE is_superuser = true ORDER BY created_at LIMIT 1),
  true,
  false,
  'mistral',
  'voxtral-mini-tts-2603',
  NOW(),
  NOW()
WHERE EXISTS (SELECT 1 FROM "users" WHERE is_superuser = true);

-- ============================================================================
-- Data migration: preserve existing user TTS-model customizations
-- ----------------------------------------------------------------------------
-- For any user whose `users.config_defaults->>'elevenlabsTtsModel'` is set to
-- a non-default value, create a USER-OWNED `tts_configs` row carrying that
-- model and set `users.default_tts_config_id` to point to it. This preserves
-- behavior for users on non-default ElevenLabs models (e.g., 'eleven_v3').
--
-- The JSONB `elevenlabsTtsModel` field is intentionally LEFT IN PLACE here —
-- consumers (TTSStep, ElevenLabsClient) still read it as a fallback during
-- the PR-1 transition. A subsequent commit drops it from the schema once
-- TtsConfigResolver-based reads are wired up.
-- ============================================================================

-- Step 1: create user-owned TtsConfigs for each user with a custom model
INSERT INTO "tts_configs" ("id", "name", "description", "owner_id", "is_global", "is_default", "provider", "model_id", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  'tts-byok-' || u.discord_id,
  'Auto-migrated from configOverrides.elevenlabsTtsModel JSONB (PR 1, 2026-05-02)',
  u.id,
  false,
  true,
  'elevenlabs',
  u.config_defaults->>'elevenlabsTtsModel',
  NOW(),
  NOW()
FROM "users" u
WHERE u.config_defaults ? 'elevenlabsTtsModel'
  AND u.config_defaults->>'elevenlabsTtsModel' IS NOT NULL
  AND u.config_defaults->>'elevenlabsTtsModel' <> '';

-- Step 2: point users.default_tts_config_id at the freshly-created row
UPDATE "users" u
SET "default_tts_config_id" = (
  SELECT t.id FROM "tts_configs" t
  WHERE t.owner_id = u.id
    AND t.provider = 'elevenlabs'
    AND t.model_id = u.config_defaults->>'elevenlabsTtsModel'
  ORDER BY t.created_at DESC
  LIMIT 1
)
WHERE u.config_defaults ? 'elevenlabsTtsModel'
  AND u.config_defaults->>'elevenlabsTtsModel' IS NOT NULL
  AND u.config_defaults->>'elevenlabsTtsModel' <> '';
