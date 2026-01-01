-- Extended Channel Context Migration
-- This migration:
-- 1. Creates bot_settings table for global admin settings
-- 2. Creates channel_settings table (replaces activated_channels)
-- 3. Adds supports_extended_context to personalities
-- 4. Adds deleted_at and edited_at to conversation_history for soft delete
-- 5. Migrates data from activated_channels to channel_settings
-- 6. Drops activated_channels table

-- CreateTable: bot_settings
CREATE TABLE "bot_settings" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_settings_key_key" ON "bot_settings"("key");

-- AddForeignKey
ALTER TABLE "bot_settings" ADD CONSTRAINT "bot_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Insert default extended_context_default setting
-- UUID is deterministic: uuidv5('bot_setting:extended_context_default', TZUROT_NAMESPACE)
INSERT INTO "bot_settings" ("id", "key", "value", "description", "created_at", "updated_at")
VALUES (
    'd3ba618d-42e0-5a62-9fdf-31c10da1a7a7',
    'extended_context_default',
    'false',
    'Default setting for extended channel context. When true, personalities can see recent channel messages (up to 100) when responding.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- CreateTable: channel_settings
CREATE TABLE "channel_settings" (
    "id" UUID NOT NULL,
    "channel_id" VARCHAR(20) NOT NULL,
    "guild_id" VARCHAR(20),
    "activated_personality_id" UUID,
    "auto_respond" BOOLEAN NOT NULL DEFAULT true,
    "extended_context" BOOLEAN,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_settings_channel_id_key" ON "channel_settings"("channel_id");

-- CreateIndex
CREATE INDEX "channel_settings_channel_id_idx" ON "channel_settings"("channel_id");

-- CreateIndex
CREATE INDEX "channel_settings_guild_id_idx" ON "channel_settings"("guild_id");

-- CreateIndex
CREATE INDEX "channel_settings_activated_personality_id_idx" ON "channel_settings"("activated_personality_id");

-- AddForeignKey
ALTER TABLE "channel_settings" ADD CONSTRAINT "channel_settings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_settings" ADD CONSTRAINT "channel_settings_activated_personality_id_fkey" FOREIGN KEY ("activated_personality_id") REFERENCES "personalities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrate data from activated_channels to channel_settings
-- Note: Old schema allowed multiple personalities per channel (@@unique([channelId, personalityId]))
-- New schema allows only one (channelId is unique). We keep the most recently updated entry.
INSERT INTO "channel_settings" ("id", "channel_id", "guild_id", "activated_personality_id", "auto_respond", "created_by", "created_at", "updated_at")
SELECT DISTINCT ON ("channel_id")
    "id",
    "channel_id",
    "guild_id",
    "personality_id",
    "auto_respond",
    "created_by",
    "created_at",
    "updated_at"
FROM "activated_channels"
ORDER BY "channel_id", "updated_at" DESC;

-- AlterTable: personalities - add supports_extended_context
ALTER TABLE "personalities" ADD COLUMN "supports_extended_context" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: conversation_history - add soft delete and edit tracking fields
ALTER TABLE "conversation_history" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "conversation_history" ADD COLUMN "edited_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "conversation_history_deleted_at_idx" ON "conversation_history"("deleted_at");

-- DropForeignKey (must be done before dropping table)
ALTER TABLE "activated_channels" DROP CONSTRAINT "activated_channels_created_by_fkey";
ALTER TABLE "activated_channels" DROP CONSTRAINT "activated_channels_personality_id_fkey";

-- DropTable: activated_channels (data has been migrated)
DROP TABLE "activated_channels";

-- NOTE: idx_memories_embedding pgvector index is intentionally NOT touched
-- Prisma incorrectly suggests dropping it but it's managed outside Prisma
