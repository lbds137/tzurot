-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "free_default_tts_config_id" UUID,
ADD COLUMN     "global_default_tts_config_id" UUID;

-- AddForeignKey
ALTER TABLE "admin_settings" ADD CONSTRAINT "admin_settings_global_default_tts_config_id_fkey" FOREIGN KEY ("global_default_tts_config_id") REFERENCES "tts_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_settings" ADD CONSTRAINT "admin_settings_free_default_tts_config_id_fkey" FOREIGN KEY ("free_default_tts_config_id") REFERENCES "tts_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill the new pointers from the legacy flag columns (mirrors the S3 LLM
-- pointer migration). The partial-unique index tts_configs_free_default_unique
-- guarantees <=1 is_free_default row; ORDER BY created_at makes the is_default
-- pick deterministic if drift ever produced duplicates. No-ops cleanly on a
-- fresh install where the admin_settings singleton row doesn't exist yet.
UPDATE "admin_settings" SET
  "global_default_tts_config_id" = (SELECT "id" FROM "tts_configs" WHERE "is_default" = true ORDER BY "created_at" LIMIT 1),
  "free_default_tts_config_id"   = (SELECT "id" FROM "tts_configs" WHERE "is_free_default" = true ORDER BY "created_at" LIMIT 1);
