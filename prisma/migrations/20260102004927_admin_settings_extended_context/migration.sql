-- AdminSettings Extended Context Migration
-- Replaces key-value BotSettings with structured AdminSettings model
-- Adds configurable extended context limits to ChannelSettings and Personality

-- AlterTable: Add extended context fields to channel_settings
ALTER TABLE "channel_settings" ADD COLUMN     "extended_context_max_age" INTEGER,
ADD COLUMN     "extended_context_max_images" INTEGER,
ADD COLUMN     "extended_context_max_messages" INTEGER;

-- AlterTable: Add extended context fields to personalities
ALTER TABLE "personalities" ADD COLUMN     "extended_context_max_age" INTEGER,
ADD COLUMN     "extended_context_max_images" INTEGER,
ADD COLUMN     "extended_context_max_messages" INTEGER;

-- CreateTable: New structured AdminSettings model
CREATE TABLE "admin_settings" (
    "id" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "extended_context_default" BOOLEAN NOT NULL DEFAULT true,
    "extended_context_max_messages" INTEGER NOT NULL DEFAULT 20,
    "extended_context_max_age" INTEGER,
    "extended_context_max_images" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "admin_settings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "admin_settings" ADD CONSTRAINT "admin_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrate data from legacy bot_settings to new admin_settings
-- Uses deterministic UUID for singleton row
-- Note: bot_settings stored 'true'/'false' as strings, admin_settings uses boolean
INSERT INTO "admin_settings" (
    "id",
    "updated_by",
    "created_at",
    "updated_at",
    "extended_context_default",
    "extended_context_max_messages",
    "extended_context_max_age",
    "extended_context_max_images"
)
SELECT
    '550e8400-e29b-41d4-a716-446655440001'::uuid,  -- Deterministic singleton UUID
    bs."updated_by",
    COALESCE(bs."created_at", CURRENT_TIMESTAMP),
    COALESCE(bs."updated_at", CURRENT_TIMESTAMP),
    CASE WHEN bs."value" = 'true' THEN true ELSE false END,  -- Parse string to boolean
    20,  -- Default max messages
    NULL,  -- No max age (disabled)
    0  -- No max images (disabled)
FROM "bot_settings" bs
WHERE bs."key" = 'extended_context_default'
ON CONFLICT ("id") DO NOTHING;

-- If no bot_settings row existed, insert default admin_settings
INSERT INTO "admin_settings" (
    "id",
    "created_at",
    "updated_at",
    "extended_context_default",
    "extended_context_max_messages",
    "extended_context_max_age",
    "extended_context_max_images"
)
SELECT
    '550e8400-e29b-41d4-a716-446655440001'::uuid,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    true,  -- Default: extended context enabled
    20,
    NULL,
    0
WHERE NOT EXISTS (SELECT 1 FROM "admin_settings");
