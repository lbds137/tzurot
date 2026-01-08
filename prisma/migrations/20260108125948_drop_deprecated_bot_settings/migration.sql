-- Drop deprecated bot_settings table
-- This table was replaced by admin_settings (AdminSettings model) with typed columns
-- See: services/api-gateway/src/routes/admin/settings.ts

DROP TABLE IF EXISTS "bot_settings";
