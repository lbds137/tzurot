-- AlterTable
ALTER TABLE "conversation_history" ADD COLUMN     "discord_message_id" VARCHAR(20);

-- CreateIndex
CREATE INDEX "conversation_history_discord_message_id_idx" ON "conversation_history"("discord_message_id");
