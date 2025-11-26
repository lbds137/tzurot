-- CreateTable
-- NOTE: Prisma incorrectly detects idx_memories_embedding as drift (manually-managed HNSW index)
CREATE TABLE "personality_aliases" (
    "id" UUID NOT NULL,
    "alias" VARCHAR(100) NOT NULL,
    "personality_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personality_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "personality_aliases_alias_key" ON "personality_aliases"("alias");

-- CreateIndex
CREATE INDEX "personality_aliases_personality_id_idx" ON "personality_aliases"("personality_id");

-- AddForeignKey
ALTER TABLE "personality_aliases" ADD CONSTRAINT "personality_aliases_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
