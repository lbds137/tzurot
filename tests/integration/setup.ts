/**
 * Integration Test Setup
 *
 * Environment-aware setup:
 * - Local (no DATABASE_URL): Use PGlite (in-memory Postgres with pgvector) + Redis mock
 * - Local (with DATABASE_URL): Use real Postgres + Redis mock
 * - CI (GITHUB_ACTIONS): Use real Postgres + real Redis via Service Containers
 *
 * This allows integration tests to run anywhere without external dependencies.
 */

// Set up test environment variables before any imports
// This prevents config validation errors when importing services
process.env.PROD_DATABASE_URL ??= process.env.DATABASE_URL ?? '';

import { PrismaClient } from '@tzurot/common-types';
import { PrismaPg } from '@prisma/adapter-pg';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { Redis as IORedis } from 'ioredis';
import { createRedisClientMock } from './helpers/RedisClientMock.js';

export interface TestEnvironment {
  prisma: PrismaClient;
  redis: IORedis;
  cleanup: () => Promise<void>;
}

// Store PGlite instance for cleanup
let pgliteInstance: PGlite | null = null;

/**
 * Detect if we're running in CI (GitHub Actions)
 * NOTE: Pre-push hook sets CI=true, but we only want real Redis/Postgres in actual CI
 */
export function isCI(): boolean {
  return process.env.GITHUB_ACTIONS === 'true';
}

/**
 * Initialize PGlite with the required schema for integration tests
 */
async function initializePGliteSchema(prisma: PrismaClient): Promise<void> {
  // Enable pgvector extension first (required before using vector type)
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);

  // Create tables in dependency order (referenced tables first)

  // Users table (no dependencies)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      discord_id VARCHAR(20) UNIQUE NOT NULL,
      username VARCHAR(255) NOT NULL,
      timezone VARCHAR(50) DEFAULT 'UTC',
      is_superuser BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // User API keys table (references users) - encrypted storage for BYOK
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS user_api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(20) DEFAULT 'openrouter',
      iv VARCHAR(32) NOT NULL,
      content TEXT NOT NULL,
      tag VARCHAR(32) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      last_used_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, provider)
    )
  `);

  // System prompts table (no dependencies)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS system_prompts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // LLM configs table (references users)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS llm_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
      is_global BOOLEAN DEFAULT FALSE,
      is_default BOOLEAN DEFAULT FALSE,
      is_free_default BOOLEAN DEFAULT FALSE,
      provider VARCHAR(20) DEFAULT 'openrouter',
      model VARCHAR(255) NOT NULL,
      vision_model VARCHAR(255),
      temperature DECIMAL(3, 2),
      top_p DECIMAL(3, 2),
      top_k INTEGER,
      frequency_penalty DECIMAL(3, 2),
      presence_penalty DECIMAL(3, 2),
      repetition_penalty DECIMAL(3, 2),
      max_tokens INTEGER,
      memory_score_threshold DECIMAL(3, 2),
      memory_limit INTEGER,
      context_window_tokens INTEGER DEFAULT 131072,
      advanced_parameters JSONB,
      max_referenced_messages INTEGER DEFAULT 20,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Personas table (references users)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS personas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      preferred_name VARCHAR(255),
      pronouns VARCHAR(100),
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Personalities table (references system_prompts and users)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS personalities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      display_name VARCHAR(255),
      slug VARCHAR(255) UNIQUE NOT NULL,
      system_prompt_id UUID REFERENCES system_prompts(id),
      owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
      character_info TEXT NOT NULL,
      personality_traits TEXT NOT NULL,
      personality_tone TEXT,
      personality_age TEXT,
      personality_appearance TEXT,
      personality_likes TEXT,
      personality_dislikes TEXT,
      conversational_goals TEXT,
      conversational_examples TEXT,
      custom_fields JSONB,
      voice_enabled BOOLEAN DEFAULT FALSE,
      voice_settings JSONB,
      image_enabled BOOLEAN DEFAULT FALSE,
      image_settings JSONB,
      avatar_data BYTEA,
      error_message TEXT,
      birth_month INTEGER,
      birth_day INTEGER,
      birth_year INTEGER,
      is_public BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Personality aliases table (references personalities)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS personality_aliases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      alias VARCHAR(100) UNIQUE NOT NULL,
      personality_id UUID NOT NULL REFERENCES personalities(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Personality default configs (references personalities and llm_configs)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS personality_default_configs (
      personality_id UUID PRIMARY KEY UNIQUE REFERENCES personalities(id) ON DELETE CASCADE,
      llm_config_id UUID NOT NULL REFERENCES llm_configs(id) ON DELETE CASCADE,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Conversation history (references personalities and personas)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS conversation_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_id VARCHAR(20) NOT NULL,
      guild_id VARCHAR(20),
      personality_id UUID NOT NULL REFERENCES personalities(id) ON DELETE CASCADE,
      persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER,
      discord_message_id TEXT[] DEFAULT '{}',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Memories table with pgvector (references personas and personalities)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS memories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,
      personality_id UUID NOT NULL REFERENCES personalities(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      embedding vector(1536),
      is_summarized BOOLEAN DEFAULT FALSE,
      original_message_count INTEGER,
      summarized_at TIMESTAMP,
      session_id VARCHAR(255),
      canon_scope VARCHAR(20),
      summary_type VARCHAR(50),
      channel_id VARCHAR(20),
      guild_id VARCHAR(20),
      message_ids TEXT[] DEFAULT '{}',
      senders TEXT[] DEFAULT '{}',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      legacy_shapes_user_id UUID,
      source_system VARCHAR(50) DEFAULT 'tzurot-v3'
    )
  `);

  // Job results table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS job_results (
      job_id VARCHAR(255) PRIMARY KEY,
      request_id VARCHAR(255) NOT NULL,
      result JSONB NOT NULL,
      status VARCHAR(50) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP,
      delivered_at TIMESTAMP
    )
  `);

  // Activated channels (references users and personalities)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS activated_channels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_id VARCHAR(20) NOT NULL,
      personality_id UUID NOT NULL REFERENCES personalities(id) ON DELETE CASCADE,
      auto_respond BOOLEAN DEFAULT TRUE,
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(channel_id, personality_id)
    )
  `);

  // Pending memories (references conversation_history)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS pending_memories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_history_id UUID UNIQUE REFERENCES conversation_history(id) ON DELETE CASCADE,
      persona_id UUID NOT NULL,
      personality_id UUID NOT NULL,
      text TEXT NOT NULL,
      metadata JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      attempts INTEGER DEFAULT 0,
      last_attempt_at TIMESTAMP,
      error TEXT
    )
  `);

  // User default personas
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS user_default_personas (
      user_id UUID PRIMARY KEY UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Personality owners
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS personality_owners (
      personality_id UUID NOT NULL REFERENCES personalities(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(50) DEFAULT 'owner',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (personality_id, user_id)
    )
  `);

  // User personality configs
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS user_personality_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      personality_id UUID NOT NULL REFERENCES personalities(id) ON DELETE CASCADE,
      persona_id UUID REFERENCES personas(id),
      llm_config_id UUID REFERENCES llm_configs(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, personality_id)
    )
  `);

  // Shapes persona mappings
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS shapes_persona_mappings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shapes_user_id UUID UNIQUE NOT NULL,
      persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      mapped_at TIMESTAMP NOT NULL DEFAULT NOW(),
      mapped_by UUID,
      verification_status VARCHAR(50) DEFAULT 'unverified'
    )
  `);

  // Usage logs table (references users) - API usage tracking for BYOK billing
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(20) NOT NULL,
      model VARCHAR(255) NOT NULL,
      tokens_in INTEGER NOT NULL,
      tokens_out INTEGER NOT NULL,
      request_type VARCHAR(50) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Create indexes for performance
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_personalities_slug ON personalities(slug)`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_memories_persona_id ON memories(persona_id)`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_memories_personality_id ON memories(personality_id)`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS usage_logs_user_id_idx ON usage_logs(user_id)`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS usage_logs_created_at_idx ON usage_logs(created_at)`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS usage_logs_user_id_created_at_idx ON usage_logs(user_id, created_at)`
  );
}

/**
 * Set up local test environment with PGlite (no external database needed)
 */
async function setupPGlite(): Promise<TestEnvironment> {
  // Create PGlite instance with pgvector extension
  pgliteInstance = new PGlite({
    extensions: { vector },
  });

  // Create Prisma adapter for PGlite
  const adapter = new PrismaPGlite(pgliteInstance);
  const prisma = new PrismaClient({ adapter }) as PrismaClient;

  // Initialize schema
  await initializePGliteSchema(prisma);

  // Create Redis mock (ioredis-compatible)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const redis: IORedis = createRedisClientMock() as unknown as IORedis;

  return {
    prisma,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    redis,
    cleanup: async () => {
      await prisma.$disconnect();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await redis.quit();
      if (pgliteInstance) {
        await pgliteInstance.close();
        pgliteInstance = null;
      }
    },
  };
}

/**
 * Set up local test environment with real Postgres from DATABASE_URL
 */
function setupWithRealDatabase(): TestEnvironment {
  const databaseUrl = process.env.DATABASE_URL ?? '';

  // Use driver adapter pattern for Prisma 7
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  // Create a Redis mock instance for local development (ioredis-compatible)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const redis: IORedis = createRedisClientMock() as unknown as IORedis;

  return {
    prisma,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    redis,
    cleanup: async () => {
      await prisma.$disconnect();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await redis.quit();
    },
  };
}

/**
 * Set up CI test environment (real Postgres + Redis)
 * Uses ioredis (unified Redis client for all services - BullMQ requires it anyway)
 */
function setupCI(): TestEnvironment {
  // In CI, use environment variables pointing to service containers
  const databaseUrl =
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/tzurot_test';
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

  // Use driver adapter pattern for Prisma 7
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  // Parse Redis URL for ioredis (connects lazily)
  const url = new URL(redisUrl);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
  const redis: IORedis = new IORedis({
    host: url.hostname,
    port: parseInt(url.port, 10) || 6379,
    password: url.password || undefined,
    username: url.username || undefined,
  });

  return {
    prisma,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    redis,
    cleanup: async () => {
      await prisma.$disconnect();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await redis.quit();
    },
  };
}

/**
 * Set up test environment (automatically detects CI vs local)
 */
export async function setupTestEnvironment(): Promise<TestEnvironment> {
  if (isCI()) {
    return setupCI();
  } else if (process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL.length > 0) {
    // If DATABASE_URL is set locally, use real database
    return setupWithRealDatabase();
  } else {
    // Default: use PGlite (no external dependencies)
    return setupPGlite();
  }
}
