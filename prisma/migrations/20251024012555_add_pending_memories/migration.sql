-- CreateTable
CREATE TABLE "pending_memories" (
    "id" UUID NOT NULL,
    "conversation_history_id" UUID NOT NULL,
    "persona_id" UUID NOT NULL,
    "personality_id" UUID NOT NULL,
    "personality_name" VARCHAR(255),
    "text" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "pending_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_memories_conversation_history_id_key" ON "pending_memories"("conversation_history_id");

-- CreateIndex
CREATE INDEX "pending_memories_persona_id_idx" ON "pending_memories"("persona_id");

-- CreateIndex
CREATE INDEX "pending_memories_personality_id_idx" ON "pending_memories"("personality_id");

-- CreateIndex
CREATE INDEX "pending_memories_created_at_idx" ON "pending_memories"("created_at");

-- AddForeignKey
ALTER TABLE "pending_memories" ADD CONSTRAINT "pending_memories_conversation_history_id_fkey" FOREIGN KEY ("conversation_history_id") REFERENCES "conversation_history"("id") ON DELETE CASCADE ON UPDATE CASCADE;
