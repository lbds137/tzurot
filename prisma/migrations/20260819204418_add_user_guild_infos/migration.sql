-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- CreateTable
CREATE TABLE "user_guild_infos" (
    "user_id" UUID NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "roles" TEXT[],
    "display_color" VARCHAR(7),
    "joined_at" TIMESTAMP(3),
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_guild_infos_pkey" PRIMARY KEY ("user_id","guild_id")
);

-- AddForeignKey
ALTER TABLE "user_guild_infos" ADD CONSTRAINT "user_guild_infos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
