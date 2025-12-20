-- Add guildId column to activated_channels for server-scoped filtering
-- Nullable because existing records don't have this data (will be backfilled lazily)
ALTER TABLE "activated_channels" ADD COLUMN "guild_id" VARCHAR(20);

-- Add index for filtering by guild
CREATE INDEX "activated_channels_guild_id_idx" ON "activated_channels"("guild_id");
