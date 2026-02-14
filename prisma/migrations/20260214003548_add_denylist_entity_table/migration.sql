-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- CreateTable
CREATE TABLE "denylisted_entities" (
    "id" UUID NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "discord_id" VARCHAR(20) NOT NULL,
    "scope" VARCHAR(15) NOT NULL DEFAULT 'BOT',
    "scope_id" VARCHAR(40) NOT NULL DEFAULT '*',
    "reason" TEXT,
    "added_by" VARCHAR(20) NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "denylisted_entities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "denylisted_entities_type_discord_id_idx" ON "denylisted_entities"("type", "discord_id");

-- CreateIndex
CREATE UNIQUE INDEX "denylisted_entities_type_discord_id_scope_scope_id_key" ON "denylisted_entities"("type", "discord_id", "scope", "scope_id");

-- CreateIndex
-- REMOVED: CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id");
