-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- CreateTable
CREATE TABLE "persona_personality_digests" (
    "id" UUID NOT NULL,
    "persona_id" UUID NOT NULL,
    "personality_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "digest_text" TEXT,
    "digest_status" VARCHAR(10),
    "digest_attempts" INTEGER NOT NULL DEFAULT 0,
    "digest_model" TEXT,
    "digest_prompt_version" INTEGER,
    "source_watermark" TIMESTAMP(3),
    "window_start" TIMESTAMP(3),
    "source_row_count" INTEGER NOT NULL DEFAULT 0,
    "source_row_ids" TEXT[],
    "source_epoch" TIMESTAMP(3),
    "generated_at" TIMESTAMP(3),
    "requested_at" TIMESTAMP(3),
    "last_error" VARCHAR(40),

    CONSTRAINT "persona_personality_digests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "persona_personality_digests_persona_id_personality_id_key" ON "persona_personality_digests"("persona_id", "personality_id");

-- AddForeignKey
ALTER TABLE "persona_personality_digests" ADD CONSTRAINT "persona_personality_digests_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_personality_digests" ADD CONSTRAINT "persona_personality_digests_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
