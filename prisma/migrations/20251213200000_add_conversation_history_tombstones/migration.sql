-- CreateTable
CREATE TABLE "conversation_history_tombstones" (
    "id" UUID NOT NULL,
    "channel_id" VARCHAR(20) NOT NULL,
    "personality_id" UUID NOT NULL,
    "persona_id" UUID NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_history_tombstones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_history_tombstones_channel_id_personality_id_p_idx" ON "conversation_history_tombstones"("channel_id", "personality_id", "persona_id");

-- CreateIndex
CREATE INDEX "conversation_history_tombstones_deleted_at_idx" ON "conversation_history_tombstones"("deleted_at");
