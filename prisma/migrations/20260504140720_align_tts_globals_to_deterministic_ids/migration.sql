-- Align TTS system-global rows to deterministic UUIDs (uuidv5).
--
-- Before this migration: dev and prod each generated random UUIDs via
-- `gen_random_uuid()` (migration 20260502185237) and `newTtsConfigId()`
-- UUIDv7 in `TtsConfigService.bootstrapSystemGlobalsIfNeeded`. Each env
-- bootstrapped independently, so the same logical row (`kyutai-self-hosted`,
-- `elevenlabs-multilingual-v2`, `mistral-voxtral-mini`) ended up with
-- different surrogate IDs across envs. `/admin db-sync` then failed with
-- `tts_configs_owner_id_name_key` violations because db-sync inserts by id
-- and the (owner_id, name) composite-unique constraint fired on the target
-- env's pre-existing row with the same name.
--
-- This migration aligns the 3 well-known system-global rows to deterministic
-- UUIDs computed via `uuidv5('tts_config_global:${name}', TZUROT_NAMESPACE)`
-- where TZUROT_NAMESPACE is the standard DNS namespace
-- `6ba7b810-9dad-11d1-80b4-00c04fd430c8`. The literal UUIDs below are the
-- output of `generateSystemGlobalTtsConfigUuid(name)` from
-- `packages/common-types/src/utils/deterministicUuid.ts` — pinned in tests
-- so this migration won't drift if the helper is ever modified.
--
-- Going forward, both the migration seed (none required for the helper, but
-- the application bootstrap path uses it) and
-- `TtsConfigService.bootstrapSystemGlobalsIfNeeded` use the same helper, so
-- future fresh DBs come up with these IDs already correct.
--
-- FK cascade: every FK to `tts_configs.id` declares `ON UPDATE CASCADE`.
-- UPDATEs propagate automatically to:
--   - users.default_tts_config_id (constraint
--     users_default_tts_config_id_fkey; DEFERRABLE INITIALLY IMMEDIATE per
--     migration 20260504065151 — but no special transaction handling needed
--     here since we're not writing the conflicting rows in the same
--     statement, just relying on the cascade)
--   - personality_default_tts_configs.tts_config_id (constraint
--     personality_default_tts_configs_tts_config_id_fkey, added in
--     migration 20260502185237)
--   - user_personality_configs.tts_config_id (constraint
--     user_personality_configs_tts_config_id_fkey, added in migration
--     20260502185237)
-- No explicit FK-fixup SQL needed.
--
-- Idempotent: WHERE clauses skip rows that already have the target id
-- (covers re-runs, plus any env where the bootstrap already happened to
-- produce these IDs by accident — vanishingly improbable but free).
--
-- This is the first PK-rewriting migration in the codebase. The
-- DEFERRABLE-FK + ON UPDATE CASCADE infrastructure existed already; this
-- migration just leverages it.

UPDATE "tts_configs"
SET "id" = '50411d3c-cc98-5f39-839e-abd4fb84b0c8'::uuid,
    "updated_at" = NOW()
WHERE "name" = 'kyutai-self-hosted'
  AND "is_global" = true
  AND "id" != '50411d3c-cc98-5f39-839e-abd4fb84b0c8'::uuid;

UPDATE "tts_configs"
SET "id" = '845d224f-ad28-5ce1-8b27-f5588d3ae2d1'::uuid,
    "updated_at" = NOW()
WHERE "name" = 'elevenlabs-multilingual-v2'
  AND "is_global" = true
  AND "id" != '845d224f-ad28-5ce1-8b27-f5588d3ae2d1'::uuid;

UPDATE "tts_configs"
SET "id" = '8aa02cad-2c39-5b5b-9d37-482aacb7788d'::uuid,
    "updated_at" = NOW()
WHERE "name" = 'mistral-voxtral-mini'
  AND "is_global" = true
  AND "id" != '8aa02cad-2c39-5b5b-9d37-482aacb7788d'::uuid;
