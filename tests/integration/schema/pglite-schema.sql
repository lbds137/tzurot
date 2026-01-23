-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "discord_id" VARCHAR(20) NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'UTC',
    "is_superuser" BOOLEAN NOT NULL DEFAULT false,
    "default_llm_config_id" UUID,
    "default_persona_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "model" VARCHAR(255) NOT NULL,
    "tokens_in" INTEGER NOT NULL,
    "tokens_out" INTEGER NOT NULL,
    "request_type" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "user_api_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL DEFAULT 'openrouter',
    "iv" VARCHAR(32) NOT NULL,
    "content" TEXT NOT NULL,
    "tag" VARCHAR(32) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "user_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personas" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "preferred_name" VARCHAR(255),
    "pronouns" VARCHAR(100),
    "share_ltm_across_personalities" BOOLEAN NOT NULL DEFAULT false,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_prompts" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_configs" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "owner_id" UUID,
    "is_global" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_free_default" BOOLEAN NOT NULL DEFAULT false,
    "provider" VARCHAR(20) NOT NULL DEFAULT 'openrouter',
    "model" VARCHAR(255) NOT NULL,
    "vision_model" VARCHAR(255),
    "advanced_parameters" JSONB,
    "max_referenced_messages" INTEGER NOT NULL DEFAULT 100,
    "temperature" DECIMAL(3,2),
    "top_p" DECIMAL(3,2),
    "top_k" INTEGER,
    "frequency_penalty" DECIMAL(3,2),
    "presence_penalty" DECIMAL(3,2),
    "repetition_penalty" DECIMAL(3,2),
    "max_tokens" INTEGER,
    "memory_score_threshold" DECIMAL(3,2),
    "memory_limit" INTEGER,
    "context_window_tokens" INTEGER NOT NULL DEFAULT 131072,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personality_default_configs" (
    "personality_id" UUID NOT NULL,
    "llm_config_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personality_default_configs_pkey" PRIMARY KEY ("personality_id")
);

-- CreateTable
CREATE TABLE "personalities" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255),
    "slug" VARCHAR(255) NOT NULL,
    "system_prompt_id" UUID,
    "owner_id" UUID,
    "character_info" TEXT NOT NULL,
    "personality_traits" TEXT NOT NULL,
    "personality_tone" TEXT,
    "personality_age" TEXT,
    "personality_appearance" TEXT,
    "personality_likes" TEXT,
    "personality_dislikes" TEXT,
    "conversational_goals" TEXT,
    "conversational_examples" TEXT,
    "custom_fields" JSONB,
    "error_message" TEXT,
    "birth_month" INTEGER,
    "birth_day" INTEGER,
    "birth_year" INTEGER,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "voice_enabled" BOOLEAN NOT NULL DEFAULT false,
    "voice_settings" JSONB,
    "image_enabled" BOOLEAN NOT NULL DEFAULT false,
    "image_settings" JSONB,
    "avatar_data" BYTEA,
    "extended_context" BOOLEAN,
    "extended_context_max_messages" INTEGER,
    "extended_context_max_age" INTEGER,
    "extended_context_max_images" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personalities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personality_owners" (
    "personality_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(50) NOT NULL DEFAULT 'owner',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personality_owners_pkey" PRIMARY KEY ("personality_id","user_id")
);

-- CreateTable
CREATE TABLE "personality_aliases" (
    "id" UUID NOT NULL,
    "alias" VARCHAR(100) NOT NULL,
    "personality_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personality_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_personality_configs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "personality_id" UUID NOT NULL,
    "persona_id" UUID,
    "llm_config_id" UUID,
    "focus_mode_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_personality_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_persona_history_configs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "personality_id" UUID NOT NULL,
    "persona_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_context_reset" TIMESTAMP(3),
    "previous_context_reset" TIMESTAMP(3),

    CONSTRAINT "user_persona_history_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_history" (
    "id" UUID NOT NULL,
    "channel_id" VARCHAR(20) NOT NULL,
    "guild_id" VARCHAR(20),
    "personality_id" UUID NOT NULL,
    "persona_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER,
    "discord_message_id" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "message_metadata" JSONB DEFAULT '{}',
    "deleted_at" TIMESTAMP(3),
    "edited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_history_tombstones" (
    "id" UUID NOT NULL,
    "channel_id" VARCHAR(20) NOT NULL,
    "personality_id" UUID NOT NULL,
    "persona_id" UUID NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_history_tombstones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_memories" (
    "id" UUID NOT NULL,
    "conversation_history_id" UUID,
    "persona_id" UUID NOT NULL,
    "personality_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "pending_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_settings" (
    "id" UUID NOT NULL,
    "channel_id" VARCHAR(20) NOT NULL,
    "guild_id" VARCHAR(20),
    "activated_personality_id" UUID,
    "auto_respond" BOOLEAN NOT NULL DEFAULT true,
    "extended_context" BOOLEAN,
    "extended_context_max_messages" INTEGER,
    "extended_context_max_age" INTEGER,
    "extended_context_max_images" INTEGER,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memories" (
    "id" UUID NOT NULL,
    "persona_id" UUID,
    "personality_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector,
    "is_summarized" BOOLEAN NOT NULL DEFAULT false,
    "original_message_count" INTEGER,
    "summarized_at" TIMESTAMP(3),
    "session_id" VARCHAR(255),
    "canon_scope" VARCHAR(20),
    "summary_type" VARCHAR(50),
    "channel_id" VARCHAR(20),
    "guild_id" VARCHAR(20),
    "message_ids" TEXT[],
    "senders" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacy_shapes_user_id" UUID,
    "source_system" VARCHAR(50) NOT NULL DEFAULT 'tzurot-v3',
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "visibility" VARCHAR(20) NOT NULL DEFAULT 'normal',
    "chunk_group_id" UUID,
    "chunk_index" INTEGER,
    "total_chunks" INTEGER,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shapes_persona_mappings" (
    "id" UUID NOT NULL,
    "shapes_user_id" UUID NOT NULL,
    "persona_id" UUID NOT NULL,
    "mapped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mapped_by" UUID,
    "verification_status" VARCHAR(50) NOT NULL DEFAULT 'unverified',

    CONSTRAINT "shapes_persona_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_results" (
    "job_id" VARCHAR(255) NOT NULL,
    "request_id" VARCHAR(255) NOT NULL,
    "result" JSONB NOT NULL,
    "status" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "job_results_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable
CREATE TABLE "image_description_cache" (
    "id" UUID NOT NULL,
    "attachment_id" VARCHAR(20) NOT NULL,
    "description" TEXT NOT NULL,
    "model" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "image_description_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_diagnostic_logs" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" VARCHAR(255) NOT NULL,
    "personality_id" UUID,
    "user_id" VARCHAR(20),
    "guild_id" VARCHAR(20),
    "channel_id" VARCHAR(20),
    "model" VARCHAR(255) NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "llm_diagnostic_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_discord_id_key" ON "users"("discord_id");

-- CreateIndex
CREATE INDEX "users_discord_id_idx" ON "users"("discord_id");

-- CreateIndex
CREATE INDEX "users_default_llm_config_id_idx" ON "users"("default_llm_config_id");

-- CreateIndex
CREATE INDEX "users_default_persona_id_idx" ON "users"("default_persona_id");

-- CreateIndex
CREATE INDEX "usage_logs_user_id_idx" ON "usage_logs"("user_id");

-- CreateIndex
CREATE INDEX "usage_logs_created_at_idx" ON "usage_logs"("created_at");

-- CreateIndex
CREATE INDEX "usage_logs_provider_idx" ON "usage_logs"("provider");

-- CreateIndex
CREATE INDEX "usage_logs_user_id_created_at_idx" ON "usage_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "usage_logs_user_id_provider_idx" ON "usage_logs"("user_id", "provider");

-- CreateIndex
CREATE INDEX "usage_logs_user_id_provider_created_at_idx" ON "usage_logs"("user_id", "provider", "created_at");

-- CreateIndex
CREATE INDEX "user_api_keys_user_id_idx" ON "user_api_keys"("user_id");

-- CreateIndex
CREATE INDEX "user_api_keys_provider_idx" ON "user_api_keys"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "user_api_keys_user_id_provider_key" ON "user_api_keys"("user_id", "provider");

-- CreateIndex
CREATE INDEX "personas_owner_id_idx" ON "personas"("owner_id");

-- CreateIndex
CREATE INDEX "system_prompts_is_default_idx" ON "system_prompts"("is_default");

-- CreateIndex
CREATE INDEX "llm_configs_owner_id_idx" ON "llm_configs"("owner_id");

-- CreateIndex
CREATE INDEX "llm_configs_is_global_idx" ON "llm_configs"("is_global");

-- CreateIndex
CREATE INDEX "llm_configs_is_free_default_idx" ON "llm_configs"("is_free_default");

-- CreateIndex
CREATE UNIQUE INDEX "personality_default_configs_personality_id_key" ON "personality_default_configs"("personality_id");

-- CreateIndex
CREATE INDEX "personality_default_configs_llm_config_id_idx" ON "personality_default_configs"("llm_config_id");

-- CreateIndex
CREATE UNIQUE INDEX "personalities_slug_key" ON "personalities"("slug");

-- CreateIndex
CREATE INDEX "personalities_slug_idx" ON "personalities"("slug");

-- CreateIndex
CREATE INDEX "personalities_owner_id_idx" ON "personalities"("owner_id");

-- CreateIndex
CREATE INDEX "personality_owners_user_id_idx" ON "personality_owners"("user_id");

-- CreateIndex
CREATE INDEX "personality_owners_personality_id_idx" ON "personality_owners"("personality_id");

-- CreateIndex
CREATE UNIQUE INDEX "personality_aliases_alias_key" ON "personality_aliases"("alias");

-- CreateIndex
CREATE INDEX "personality_aliases_personality_id_idx" ON "personality_aliases"("personality_id");

-- CreateIndex
CREATE INDEX "user_personality_configs_user_id_idx" ON "user_personality_configs"("user_id");

-- CreateIndex
CREATE INDEX "user_personality_configs_personality_id_idx" ON "user_personality_configs"("personality_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_personality_configs_user_id_personality_id_key" ON "user_personality_configs"("user_id", "personality_id");

-- CreateIndex
CREATE INDEX "user_persona_history_configs_user_id_idx" ON "user_persona_history_configs"("user_id");

-- CreateIndex
CREATE INDEX "user_persona_history_configs_personality_id_idx" ON "user_persona_history_configs"("personality_id");

-- CreateIndex
CREATE INDEX "user_persona_history_configs_persona_id_idx" ON "user_persona_history_configs"("persona_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_persona_history_configs_user_id_personality_id_persona_key" ON "user_persona_history_configs"("user_id", "personality_id", "persona_id");

-- CreateIndex
CREATE INDEX "conversation_history_channel_id_personality_id_created_at_idx" ON "conversation_history"("channel_id", "personality_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "conversation_history_persona_id_idx" ON "conversation_history"("persona_id");

-- CreateIndex
CREATE INDEX "conversation_history_discord_message_id_idx" ON "conversation_history"("discord_message_id");

-- CreateIndex
CREATE INDEX "conversation_history_message_metadata_idx" ON "conversation_history" USING GIN ("message_metadata");

-- CreateIndex
CREATE INDEX "conversation_history_deleted_at_idx" ON "conversation_history"("deleted_at");

-- CreateIndex
CREATE INDEX "conversation_history_tombstones_channel_id_personality_id_p_idx" ON "conversation_history_tombstones"("channel_id", "personality_id", "persona_id");

-- CreateIndex
CREATE INDEX "conversation_history_tombstones_deleted_at_idx" ON "conversation_history_tombstones"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "pending_memories_conversation_history_id_key" ON "pending_memories"("conversation_history_id");

-- CreateIndex
CREATE INDEX "pending_memories_persona_id_idx" ON "pending_memories"("persona_id");

-- CreateIndex
CREATE INDEX "pending_memories_personality_id_idx" ON "pending_memories"("personality_id");

-- CreateIndex
CREATE INDEX "pending_memories_created_at_idx" ON "pending_memories"("created_at");

-- CreateIndex
CREATE INDEX "pending_memories_attempts_created_at_idx" ON "pending_memories"("attempts", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "channel_settings_channel_id_key" ON "channel_settings"("channel_id");

-- CreateIndex
CREATE INDEX "channel_settings_channel_id_idx" ON "channel_settings"("channel_id");

-- CreateIndex
CREATE INDEX "channel_settings_guild_id_idx" ON "channel_settings"("guild_id");

-- CreateIndex
CREATE INDEX "channel_settings_activated_personality_id_idx" ON "channel_settings"("activated_personality_id");

-- CreateIndex
CREATE INDEX "memories_persona_id_idx" ON "memories"("persona_id");

-- CreateIndex
CREATE INDEX "memories_personality_id_idx" ON "memories"("personality_id");

-- CreateIndex
CREATE INDEX "memories_created_at_idx" ON "memories"("created_at" DESC);

-- CreateIndex
CREATE INDEX "memories_channel_id_idx" ON "memories"("channel_id");

-- CreateIndex
CREATE INDEX "memories_guild_id_idx" ON "memories"("guild_id");

-- CreateIndex
CREATE INDEX "memories_session_id_idx" ON "memories"("session_id");

-- CreateIndex
CREATE INDEX "memories_is_summarized_idx" ON "memories"("is_summarized");

-- CreateIndex
CREATE INDEX "memories_legacy_shapes_user_id_idx" ON "memories"("legacy_shapes_user_id");

-- CreateIndex
CREATE INDEX "memories_source_system_idx" ON "memories"("source_system");

-- CreateIndex
CREATE INDEX "memories_is_locked_idx" ON "memories"("is_locked");

-- CreateIndex
CREATE INDEX "memories_visibility_idx" ON "memories"("visibility");

-- CreateIndex
CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "shapes_persona_mappings_shapes_user_id_key" ON "shapes_persona_mappings"("shapes_user_id");

-- CreateIndex
CREATE INDEX "shapes_persona_mappings_persona_id_idx" ON "shapes_persona_mappings"("persona_id");

-- CreateIndex
CREATE INDEX "job_results_status_completed_at_idx" ON "job_results"("status", "completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "image_description_cache_attachment_id_key" ON "image_description_cache"("attachment_id");

-- CreateIndex
CREATE UNIQUE INDEX "llm_diagnostic_logs_request_id_key" ON "llm_diagnostic_logs"("request_id");

-- CreateIndex
CREATE INDEX "llm_diagnostic_logs_created_at_idx" ON "llm_diagnostic_logs"("created_at");

-- CreateIndex
CREATE INDEX "llm_diagnostic_logs_personality_id_idx" ON "llm_diagnostic_logs"("personality_id");

-- CreateIndex
CREATE INDEX "llm_diagnostic_logs_user_id_idx" ON "llm_diagnostic_logs"("user_id");

-- CreateIndex
CREATE INDEX "llm_diagnostic_logs_channel_id_idx" ON "llm_diagnostic_logs"("channel_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_default_llm_config_id_fkey" FOREIGN KEY ("default_llm_config_id") REFERENCES "llm_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_default_persona_id_fkey" FOREIGN KEY ("default_persona_id") REFERENCES "personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_settings" ADD CONSTRAINT "admin_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_api_keys" ADD CONSTRAINT "user_api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personas" ADD CONSTRAINT "personas_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_configs" ADD CONSTRAINT "llm_configs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personality_default_configs" ADD CONSTRAINT "personality_default_configs_llm_config_id_fkey" FOREIGN KEY ("llm_config_id") REFERENCES "llm_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personality_default_configs" ADD CONSTRAINT "personality_default_configs_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personalities" ADD CONSTRAINT "personalities_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personalities" ADD CONSTRAINT "personalities_system_prompt_id_fkey" FOREIGN KEY ("system_prompt_id") REFERENCES "system_prompts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personality_owners" ADD CONSTRAINT "personality_owners_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personality_owners" ADD CONSTRAINT "personality_owners_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personality_aliases" ADD CONSTRAINT "personality_aliases_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_personality_configs" ADD CONSTRAINT "user_personality_configs_llm_config_id_fkey" FOREIGN KEY ("llm_config_id") REFERENCES "llm_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_personality_configs" ADD CONSTRAINT "user_personality_configs_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_personality_configs" ADD CONSTRAINT "user_personality_configs_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_personality_configs" ADD CONSTRAINT "user_personality_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_persona_history_configs" ADD CONSTRAINT "user_persona_history_configs_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_persona_history_configs" ADD CONSTRAINT "user_persona_history_configs_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_persona_history_configs" ADD CONSTRAINT "user_persona_history_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_history" ADD CONSTRAINT "conversation_history_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_history" ADD CONSTRAINT "conversation_history_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_memories" ADD CONSTRAINT "pending_memories_conversation_history_id_fkey" FOREIGN KEY ("conversation_history_id") REFERENCES "conversation_history"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_settings" ADD CONSTRAINT "channel_settings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_settings" ADD CONSTRAINT "channel_settings_activated_personality_id_fkey" FOREIGN KEY ("activated_personality_id") REFERENCES "personalities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shapes_persona_mappings" ADD CONSTRAINT "shapes_persona_mappings_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

