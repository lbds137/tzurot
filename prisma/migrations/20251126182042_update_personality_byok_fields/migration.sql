-- AlterTable
-- NOTE: Prisma incorrectly detects idx_memories_embedding as drift (manually-managed HNSW index)
ALTER TABLE "personalities" ADD COLUMN     "birthday" DATE,
ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "is_public" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "owner_id" UUID;

-- CreateIndex
CREATE INDEX "personalities_owner_id_idx" ON "personalities"("owner_id");

-- AddForeignKey
ALTER TABLE "personalities" ADD CONSTRAINT "personalities_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
