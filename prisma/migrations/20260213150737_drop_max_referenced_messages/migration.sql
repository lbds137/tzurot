/*
  Warnings:

  - You are about to drop the column `max_referenced_messages` on the `llm_configs` table. All the data in the column will be lost.

*/
-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- AlterTable
ALTER TABLE "llm_configs" DROP COLUMN "max_referenced_messages";

-- CreateIndex
-- REMOVED: CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id");
