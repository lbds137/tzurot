/*
  Warnings:

  - You are about to drop the column `focus_mode_enabled` on the `user_personality_configs` table. All the data in the column will be lost.

*/
-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- AlterTable
ALTER TABLE "user_personality_configs" DROP COLUMN "focus_mode_enabled";

-- CreateIndex
CREATE INDEX "denylisted_entities_type_added_at_idx" ON "denylisted_entities"("type", "added_at");

-- CreateIndex
-- REMOVED: CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id");
