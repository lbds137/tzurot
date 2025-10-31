-- Add guild_id to conversation_history
ALTER TABLE "conversation_history" ADD COLUMN "guild_id" VARCHAR(20);

-- Drop personality_name from memories (redundant with join to personalities table)
ALTER TABLE "memories" DROP COLUMN "personality_name";

-- Drop personality_name from pending_memories (redundant with join to personalities table)
ALTER TABLE "pending_memories" DROP COLUMN "personality_name";
