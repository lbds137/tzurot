-- NOTE: Prisma incorrectly detects idx_memories_embedding as drift (manually-managed ivfflat index)
-- DO NOT drop it - it's essential for vector similarity search performance

/*
  Warnings:

  - You are about to drop the column `birthday` on the `personalities` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "personalities" DROP COLUMN "birthday",
ADD COLUMN     "birth_day" INTEGER,
ADD COLUMN     "birth_month" INTEGER,
ADD COLUMN     "birth_year" INTEGER;
