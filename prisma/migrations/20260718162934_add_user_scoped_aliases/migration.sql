-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- DropIndex
DROP INDEX "personality_aliases_alias_key";

-- AlterTable
ALTER TABLE "personality_aliases" ADD COLUMN     "user_id" UUID;

-- CreateIndex
CREATE INDEX "personality_aliases_user_id_idx" ON "personality_aliases"("user_id");

-- AddForeignKey
ALTER TABLE "personality_aliases" ADD CONSTRAINT "personality_aliases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: partial unique indexes on the NORMALIZED alias (Prisma cannot
-- represent partial/functional uniques — protected via drift-ignore.json).
-- Global tier: one lower(alias) among all global (user_id IS NULL) rows.
CREATE UNIQUE INDEX "personality_aliases_global_alias_unique"
ON "personality_aliases" (lower("alias")) WHERE "user_id" IS NULL;

-- User tier: one lower(alias) per user among that user's own rows.
CREATE UNIQUE INDEX "personality_aliases_user_alias_unique"
ON "personality_aliases" ("user_id", lower("alias")) WHERE "user_id" IS NOT NULL;
