-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "memories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "persona_id" UUID NOT NULL,
    "personality_id" UUID NOT NULL,
    "personality_name" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "is_summarized" BOOLEAN NOT NULL DEFAULT false,
    "original_message_count" INTEGER,
    "summarized_at" TIMESTAMPTZ,
    "session_id" VARCHAR(255),
    "canon_scope" VARCHAR(20),
    "summary_type" VARCHAR(50),
    "channel_id" VARCHAR(20),
    "guild_id" VARCHAR(20),
    "message_ids" TEXT[],
    "senders" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for common queries (create these first, vector index last for better performance)
CREATE INDEX "idx_memories_persona" ON "memories"("persona_id");
CREATE INDEX "idx_memories_personality" ON "memories"("personality_id");
CREATE INDEX "idx_memories_created_at" ON "memories"("created_at" DESC);
CREATE INDEX "idx_memories_channel" ON "memories"("channel_id") WHERE "channel_id" IS NOT NULL;
CREATE INDEX "idx_memories_guild" ON "memories"("guild_id") WHERE "guild_id" IS NOT NULL;
CREATE INDEX "idx_memories_session" ON "memories"("session_id") WHERE "session_id" IS NOT NULL;
CREATE INDEX "idx_memories_is_summarized" ON "memories"("is_summarized");

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memories" ADD CONSTRAINT "memories_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- IMPORTANT: Create the HNSW vector index AFTER data is populated for better performance
-- Run this separately after migration: CREATE INDEX idx_memories_embedding ON memories USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
