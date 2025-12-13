-- CreateTable
-- Per-persona history configuration for epoch tracking (memory commands)
-- This enables each persona to have independent conversation history cutoffs
-- See ADR-003 in docs/planning/SLASH_COMMAND_ARCHITECTURE.md
CREATE TABLE "user_persona_history_configs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "personality_id" UUID NOT NULL,
    "persona_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_context_reset" TIMESTAMP(3),
    "previous_context_reset" TIMESTAMP(3),

    CONSTRAINT "user_persona_history_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_persona_history_configs_user_id_idx" ON "user_persona_history_configs"("user_id");

-- CreateIndex
CREATE INDEX "user_persona_history_configs_personality_id_idx" ON "user_persona_history_configs"("personality_id");

-- CreateIndex
CREATE INDEX "user_persona_history_configs_persona_id_idx" ON "user_persona_history_configs"("persona_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_persona_history_configs_user_id_personality_id_persona_key" ON "user_persona_history_configs"("user_id", "personality_id", "persona_id");

-- AddForeignKey
ALTER TABLE "user_persona_history_configs" ADD CONSTRAINT "user_persona_history_configs_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_persona_history_configs" ADD CONSTRAINT "user_persona_history_configs_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_persona_history_configs" ADD CONSTRAINT "user_persona_history_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NOTE: Prisma may generate statements to remove idx_memories_embedding (pgvector HNSW index)
-- This is a known drift issue documented in docs/database/PRISMA_DRIFT_ISSUES.md
-- Any such statements have been manually removed from this migration.
