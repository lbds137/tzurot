-- AlterTable: Make persona_id NOT NULL
ALTER TABLE "conversation_history" ALTER COLUMN "persona_id" SET NOT NULL;

-- DropForeignKey: Remove user_id foreign key
ALTER TABLE "conversation_history" DROP CONSTRAINT "conversation_history_user_id_fkey";

-- DropIndex: Remove user_id index
DROP INDEX "conversation_history_user_id_idx";

-- AlterTable: Drop user_id column
ALTER TABLE "conversation_history" DROP COLUMN "user_id";
