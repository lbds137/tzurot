-- AlterTable
ALTER TABLE "conversation_history" ADD COLUMN     "persona_id" UUID;

-- CreateIndex
CREATE INDEX "conversation_history_persona_id_idx" ON "conversation_history"("persona_id");

-- AddForeignKey
ALTER TABLE "conversation_history" ADD CONSTRAINT "conversation_history_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
