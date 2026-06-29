-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "free_default_llm_config_id" UUID,
ADD COLUMN     "free_default_vision_config_id" UUID,
ADD COLUMN     "global_default_llm_config_id" UUID,
ADD COLUMN     "global_default_vision_config_id" UUID;

-- AddForeignKey
ALTER TABLE "admin_settings" ADD CONSTRAINT "admin_settings_global_default_llm_config_id_fkey" FOREIGN KEY ("global_default_llm_config_id") REFERENCES "llm_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_settings" ADD CONSTRAINT "admin_settings_global_default_vision_config_id_fkey" FOREIGN KEY ("global_default_vision_config_id") REFERENCES "llm_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_settings" ADD CONSTRAINT "admin_settings_free_default_llm_config_id_fkey" FOREIGN KEY ("free_default_llm_config_id") REFERENCES "llm_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_settings" ADD CONSTRAINT "admin_settings_free_default_vision_config_id_fkey" FOREIGN KEY ("free_default_vision_config_id") REFERENCES "llm_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill the new per-slot default pointers from the existing kind-slotted flags so the
-- cutover preserves the live defaults (especially the free-tier chat default that guest /
-- no-BYOK users fall back to). The per-kind partial-unique indexes guarantee at most one
-- row per (flag, kind), so each subquery resolves to a single id (ORDER BY for determinism).
-- No-ops cleanly if the singleton row doesn't exist yet (fresh installs seed it elsewhere).
UPDATE "admin_settings" SET
  "global_default_llm_config_id"    = (SELECT "id" FROM "llm_configs" WHERE "is_default" = true AND "kind" = 'text'   AND "is_global" = true ORDER BY "created_at" LIMIT 1),
  "global_default_vision_config_id" = (SELECT "id" FROM "llm_configs" WHERE "is_default" = true AND "kind" = 'vision' AND "is_global" = true ORDER BY "created_at" LIMIT 1),
  "free_default_llm_config_id"      = (SELECT "id" FROM "llm_configs" WHERE "is_free_default" = true AND "kind" = 'text'   ORDER BY "created_at" LIMIT 1),
  "free_default_vision_config_id"   = (SELECT "id" FROM "llm_configs" WHERE "is_free_default" = true AND "kind" = 'vision' ORDER BY "created_at" LIMIT 1);
