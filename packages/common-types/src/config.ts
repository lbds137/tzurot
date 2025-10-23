import { z } from 'zod';

/**
 * Environment variable validation schema
 * Validates all required configuration at startup
 */
export const envSchema = z.object({
  // Discord Configuration
  DISCORD_TOKEN: z.string().optional(), // Only required for bot-client
  DISCORD_CLIENT_ID: z.string().optional(),
  GUILD_ID: z.string().optional(), // Optional - for dev/testing command deployment
  BOT_OWNER_ID: z.string().optional(), // Discord user ID of bot owner for admin commands
  BOT_MENTION_CHAR: z.string().length(1).default('@'), // Character used for personality mentions (@personality or &personality)

  // AI Provider Configuration
  AI_PROVIDER: z.enum(['openrouter', 'openai', 'anthropic', 'gemini', 'local']).default('openrouter'),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().optional().default('https://openrouter.ai/api/v1'),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z.string().url().optional(),
  DEFAULT_AI_MODEL: z.string().optional().default('gemini-2.5-pro'),

  // AI Model Defaults
  WHISPER_MODEL: z.string().default('whisper-1'),
  VISION_FALLBACK_MODEL: z.string().default('qwen/qwen3-vl-235b-a22b-instruct'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  // Redis Configuration
  REDIS_URL: z.string().url().optional(), // Railway provides this, no default!
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().regex(/^\d+$/).transform(Number).default('6379'),
  REDIS_PASSWORD: z.string().optional(),

  // Qdrant Configuration
  QDRANT_URL: z.string().url().optional(),
  QDRANT_API_KEY: z.string().optional(),

  // Database Configuration
  DATABASE_URL: z.string().url().optional(),

  // API Gateway Configuration
  API_GATEWAY_PORT: z.string().regex(/^\d+$/).transform(Number).default('3000'),
  API_GATEWAY_URL: z.string().url().optional().default('http://localhost:3000'),
  GATEWAY_URL: z.string().url().optional().default('http://localhost:3000'), // Alias for bot-client
  CORS_ORIGINS: z.string().optional().transform((val) => val?.split(',') ?? ['*']).default('*'),

  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Optional Services
  ELEVENLABS_API_KEY: z.string().optional(),
  IMAGE_GENERATION_API_KEY: z.string().optional(),

  // Worker Configuration
  WORKER_CONCURRENCY: z.string().regex(/^\d+$/).transform(Number).default('5'),
  QUEUE_NAME: z.string().default('ai-requests'),
  ENABLE_HEALTH_SERVER: z.string().transform((val) => val !== 'false').default('true'),
  PORT: z.string().regex(/^\d+$/).transform(Number).default('3001'),

  // Vector Store Configuration (legacy Chroma support)
  CHROMA_URL: z.string().url().optional().default('http://localhost:8000'),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validates and returns environment configuration
 * Throws detailed error if validation fails
 */
export function validateEnv(): EnvConfig {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => 
        `  - ${issue.path.join('.')}: ${issue.message}`
      ).join('\n');
      
      throw new Error(
        `Environment validation failed:\n${issues}\n\n` +
        'Please check your .env file and ensure all required variables are set.'
      );
    }
    throw error;
  }
}

/**
 * Cached config instance
 * Can be reset for testing via resetConfig()
 */
let _config: EnvConfig | undefined;

/**
 * Get validated environment configuration
 * Caches the result for performance, but can be reset via resetConfig()
 */
export function getConfig(): EnvConfig {
  _config ??= validateEnv();
  return _config;
}

/**
 * Reset the cached config (primarily for testing)
 * Allows tests to inject different environment variables
 */
export function resetConfig(): void {
  _config = undefined;
}

/**
 * Create config with custom values (for testing)
 * Bypasses environment validation and uses provided values
 */
export function createTestConfig(overrides: Partial<EnvConfig>): EnvConfig {
  const defaults = validateEnv();
  return { ...defaults, ...overrides };
}