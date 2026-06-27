/*
  Warnings:

  - You are about to drop the column `vision_model` on the `llm_configs` table. All the data in the column will be lost.

*/
-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- AlterTable
ALTER TABLE "llm_configs" DROP COLUMN "vision_model",
ADD COLUMN     "kind" VARCHAR(10) NOT NULL DEFAULT 'text';

-- AlterTable
ALTER TABLE "user_personality_configs" ADD COLUMN     "vision_config_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "default_vision_config_id" UUID;

-- CreateTable
CREATE TABLE "personality_vision_default_configs" (
    "personality_id" UUID NOT NULL,
    "llm_config_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personality_vision_default_configs_pkey" PRIMARY KEY ("personality_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "personality_vision_default_configs_personality_id_key" ON "personality_vision_default_configs"("personality_id");

-- CreateIndex
CREATE INDEX "personality_vision_default_configs_llm_config_id_idx" ON "personality_vision_default_configs"("llm_config_id");

-- CreateIndex
CREATE INDEX "llm_configs_kind_idx" ON "llm_configs"("kind");

-- CreateIndex
CREATE INDEX "users_default_vision_config_id_idx" ON "users"("default_vision_config_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_default_vision_config_id_fkey" FOREIGN KEY ("default_vision_config_id") REFERENCES "llm_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personality_vision_default_configs" ADD CONSTRAINT "personality_vision_default_configs_llm_config_id_fkey" FOREIGN KEY ("llm_config_id") REFERENCES "llm_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personality_vision_default_configs" ADD CONSTRAINT "personality_vision_default_configs_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_personality_configs" ADD CONSTRAINT "user_personality_configs_vision_config_id_fkey" FOREIGN KEY ("vision_config_id") REFERENCES "llm_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Per-kind partial-unique default indexes (HAND-WRITTEN — Prisma cannot represent
-- partial-unique indexes, so they live here + in prisma/drift-ignore.json, not in
-- the generated diff). Rework the existing singletons to be scoped per `kind` so a
-- text default AND a vision default can coexist; add a per-kind is_default singleton
-- (previously app-enforced only). At most one row per kind for each flag.
DROP INDEX "llm_configs_free_default_unique";
CREATE UNIQUE INDEX "llm_configs_free_default_unique"
  ON "llm_configs"("kind")
  WHERE "is_free_default" = true;

DROP INDEX "llm_configs_global_name_unique";
CREATE UNIQUE INDEX "llm_configs_global_name_unique"
  ON "llm_configs"("kind", "name")
  WHERE "is_global" = true;

CREATE UNIQUE INDEX "llm_configs_default_unique"
  ON "llm_configs"("kind")
  WHERE "is_default" = true;

-- Make the new vision-default FK DEFERRABLE (mirrors users_default_llm_config_id_fkey /
-- users_default_tts_config_id_fkey) so db-sync can atomically copy a user row whose
-- default_vision_config_id references a (vision-kind) llm_configs row not yet inserted.
ALTER TABLE "users" ALTER CONSTRAINT "users_default_vision_config_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
