-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- CreateTable
CREATE TABLE "secret_rotations" (
    "name" VARCHAR(50) NOT NULL,
    "rotated_at" TIMESTAMP(3) NOT NULL,
    "interval_days" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secret_rotations_pkey" PRIMARY KEY ("name")
);
