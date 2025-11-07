-- DropIndex
DROP INDEX "public"."conversation_history_discord_message_id_idx";

-- AlterTable
ALTER TABLE "pending_memories" ALTER COLUMN "conversation_history_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "conversation_history_discord_message_id_idx" ON "conversation_history"("discord_message_id");
