-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "discord_id" VARCHAR(20) NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "global_persona_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personas" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "owner_id" UUID,
    "is_global" BOOLEAN NOT NULL DEFAULT false,
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
    "model" VARCHAR(255) NOT NULL,
    "temperature" DECIMAL(3,2),
    "top_p" DECIMAL(3,2),
    "top_k" INTEGER,
    "frequency_penalty" DECIMAL(3,2),
    "presence_penalty" DECIMAL(3,2),
    "repetition_penalty" DECIMAL(3,2),
    "max_tokens" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personalities" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255),
    "slug" VARCHAR(255) NOT NULL,
    "avatar_url" TEXT,
    "system_prompt_id" UUID,
    "llm_config_id" UUID,
    "voice_enabled" BOOLEAN NOT NULL DEFAULT false,
    "voice_settings" JSONB,
    "image_enabled" BOOLEAN NOT NULL DEFAULT false,
    "image_settings" JSONB,
    "memory_enabled" BOOLEAN NOT NULL DEFAULT true,
    "context_window_size" INTEGER NOT NULL DEFAULT 20,
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

    CONSTRAINT "personality_owners_pkey" PRIMARY KEY ("personality_id","user_id")
);

-- CreateTable
CREATE TABLE "user_personality_settings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "personality_id" UUID NOT NULL,
    "persona_id" UUID,
    "llm_config_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_personality_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_history" (
    "id" UUID NOT NULL,
    "channel_id" VARCHAR(20) NOT NULL,
    "personality_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activated_channels" (
    "id" UUID NOT NULL,
    "channel_id" VARCHAR(20) NOT NULL,
    "personality_id" UUID NOT NULL,
    "auto_respond" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activated_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_discord_id_key" ON "users"("discord_id");

-- CreateIndex
CREATE INDEX "users_discord_id_idx" ON "users"("discord_id");

-- CreateIndex
CREATE INDEX "personas_owner_id_idx" ON "personas"("owner_id");

-- CreateIndex
CREATE INDEX "idx_personas_global" ON "personas"("is_global");

-- CreateIndex
CREATE UNIQUE INDEX "idx_system_prompts_default" ON "system_prompts"("is_default");

-- CreateIndex
CREATE UNIQUE INDEX "idx_llm_configs_default" ON "llm_configs"("is_default");

-- CreateIndex
CREATE UNIQUE INDEX "personalities_slug_key" ON "personalities"("slug");

-- CreateIndex
CREATE INDEX "personalities_slug_idx" ON "personalities"("slug");

-- CreateIndex
CREATE INDEX "personality_owners_user_id_idx" ON "personality_owners"("user_id");

-- CreateIndex
CREATE INDEX "personality_owners_personality_id_idx" ON "personality_owners"("personality_id");

-- CreateIndex
CREATE INDEX "user_personality_settings_user_id_idx" ON "user_personality_settings"("user_id");

-- CreateIndex
CREATE INDEX "user_personality_settings_personality_id_idx" ON "user_personality_settings"("personality_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_personality_settings_user_id_personality_id_key" ON "user_personality_settings"("user_id", "personality_id");

-- CreateIndex
CREATE INDEX "conversation_history_channel_id_personality_id_created_at_idx" ON "conversation_history"("channel_id", "personality_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "conversation_history_user_id_idx" ON "conversation_history"("user_id");

-- CreateIndex
CREATE INDEX "activated_channels_channel_id_idx" ON "activated_channels"("channel_id");

-- CreateIndex
CREATE INDEX "activated_channels_personality_id_idx" ON "activated_channels"("personality_id");

-- CreateIndex
CREATE UNIQUE INDEX "activated_channels_channel_id_personality_id_key" ON "activated_channels"("channel_id", "personality_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_global_persona_id_fkey" FOREIGN KEY ("global_persona_id") REFERENCES "personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personas" ADD CONSTRAINT "personas_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personalities" ADD CONSTRAINT "personalities_system_prompt_id_fkey" FOREIGN KEY ("system_prompt_id") REFERENCES "system_prompts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personalities" ADD CONSTRAINT "personalities_llm_config_id_fkey" FOREIGN KEY ("llm_config_id") REFERENCES "llm_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personality_owners" ADD CONSTRAINT "personality_owners_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personality_owners" ADD CONSTRAINT "personality_owners_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_personality_settings" ADD CONSTRAINT "user_personality_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_personality_settings" ADD CONSTRAINT "user_personality_settings_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_personality_settings" ADD CONSTRAINT "user_personality_settings_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_personality_settings" ADD CONSTRAINT "user_personality_settings_llm_config_id_fkey" FOREIGN KEY ("llm_config_id") REFERENCES "llm_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_history" ADD CONSTRAINT "conversation_history_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_history" ADD CONSTRAINT "conversation_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activated_channels" ADD CONSTRAINT "activated_channels_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activated_channels" ADD CONSTRAINT "activated_channels_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
