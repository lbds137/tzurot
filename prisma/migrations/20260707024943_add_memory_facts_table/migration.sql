-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- CreateTable
CREATE TABLE "memory_facts" (
    "id" UUID NOT NULL,
    "personality_id" UUID NOT NULL,
    "persona_id" UUID,
    "pool" VARCHAR(20) NOT NULL DEFAULT 'private',
    "canon_group_id" UUID,
    "is_fiction" BOOLEAN NOT NULL DEFAULT false,
    "visibility" VARCHAR(20) NOT NULL DEFAULT 'normal',
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "statement" TEXT NOT NULL,
    "embedding" vector,
    "entity_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "salience" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "tier" VARCHAR(20) NOT NULL DEFAULT 'observed',
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMP(3),
    "superseded_by_id" UUID,
    "forgotten" BOOLEAN NOT NULL DEFAULT false,
    "source_memory_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "extraction_job_id" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memory_facts_personality_id_persona_id_superseded_at_idx" ON "memory_facts"("personality_id", "persona_id", "superseded_at");

-- CreateIndex
CREATE INDEX "memory_facts_entity_tags_idx" ON "memory_facts" USING GIN ("entity_tags");

-- CreateIndex
CREATE INDEX "memory_facts_superseded_by_id_idx" ON "memory_facts"("superseded_by_id");

-- CreateIndex
CREATE INDEX "memory_facts_persona_id_idx" ON "memory_facts"("persona_id");

-- AddForeignKey
ALTER TABLE "memory_facts" ADD CONSTRAINT "memory_facts_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_facts" ADD CONSTRAINT "memory_facts_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_facts" ADD CONSTRAINT "memory_facts_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "memory_facts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterColumn (manual): Prisma's Unsupported("vector") emits a dimensionless
-- column; ivfflat requires typed dimensions (mirrors the memories precedent).
ALTER TABLE "memory_facts" ALTER COLUMN "embedding" TYPE vector(384);

-- CreateIndex (manual): IVFFlat vector index for fact similarity retrieval
-- (memory Phase 2 slice 4 queryFacts path; managed outside Prisma - see
-- prisma/drift-ignore.json). Mirrors idx_memories_embedding.
CREATE INDEX "idx_memory_facts_embedding" ON "memory_facts" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50);
