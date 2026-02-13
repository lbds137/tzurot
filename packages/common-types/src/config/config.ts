import { z } from 'zod';
import { MODEL_DEFAULTS, SERVICE_DEFAULTS, AIProvider } from '../constants/index.js';

/** Type for optional string schema that accepts undefined or transforms empty string to undefined */
type OptionalStringSchema = z.ZodType<string | undefined>;

/**
 * Helper for optional string fields that must be non-empty if provided
 * Rejects empty strings, but allows undefined
 * @returns Zod schema for optional non-empty string
 */
const optionalNonEmptyString = (): OptionalStringSchema =>
  z
    .string()
    .min(1)
    .optional()
    .or(z.literal('').transform(() => undefined));

/**
 * Helper for optional Discord IDs (must be all digits if provided)
 * @returns Zod schema for optional Discord ID
 */
const optionalDiscordId = (): OptionalStringSchema =>
  z
    .string()
    .regex(/^\d+$/, 'Must be a valid Discord ID (all digits)')
    .optional()
    .or(z.literal('').transform(() => undefined));

/**
 * Helper for optional hex encryption key (must be exactly 64 hex chars = 32 bytes if provided)
 * @returns Zod schema for optional encryption key
 */
const optionalEncryptionKey = (): OptionalStringSchema =>
  z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      'Must be exactly 64 hexadecimal characters (32 bytes for AES-256). Generate with: openssl rand -hex 32'
    )
    .optional()
    .or(z.literal('').transform(() => undefined));

/**
 * Environment variable validation schema
 * Validates all required configuration at startup
 */
export const envSchema = z.object({
  // Discord Configuration
  DISCORD_TOKEN: optionalNonEmptyString(), // Only required for bot-client
  DISCORD_CLIENT_ID: optionalDiscordId(),
  GUILD_ID: optionalDiscordId(), // Optional - for dev/testing command deployment
  AUTO_DEPLOY_COMMANDS: z
    .enum(['true', 'false'])
    .optional()
    .or(z.literal('').transform(() => undefined)), // 'true' to auto-deploy slash commands on bot startup
  AUTO_TRANSCRIBE_VOICE: z
    .enum(['true', 'false'])
    .optional()
    .or(z.literal('').transform(() => undefined)), // 'true' to automatically transcribe voice messages as bot
  BOT_OWNER_ID: optionalDiscordId(), // Discord user ID of bot owner for admin commands
  BOT_MENTION_CHAR: z.string().length(1).default('@'), // Character used for personality mentions (@personality or &personality)
  INTERNAL_SERVICE_SECRET: optionalNonEmptyString(), // Shared secret for service-to-service auth (bot-client -> api-gateway)

  // AI Provider Configuration
  AI_PROVIDER: z.nativeEnum(AIProvider).default(AIProvider.OpenRouter),
  OPENROUTER_API_KEY: optionalNonEmptyString(),
  OPENROUTER_APP_TITLE: optionalNonEmptyString(),
  OPENAI_API_KEY: optionalNonEmptyString(),
  DEFAULT_AI_MODEL: optionalNonEmptyString().transform(val => val ?? MODEL_DEFAULTS.DEFAULT_MODEL),

  // AI Model Defaults
  WHISPER_MODEL: z.string().default(MODEL_DEFAULTS.WHISPER),
  VISION_FALLBACK_MODEL: z.string().default(MODEL_DEFAULTS.VISION_FALLBACK),
  // Note: Embeddings are local (Xenova/bge-small-en-v1.5) - no env config needed

  // Redis Configuration
  REDIS_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)), // Railway provides this, no default!
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().regex(/^\d+$/).transform(Number).default(SERVICE_DEFAULTS.REDIS_PORT),
  REDIS_PASSWORD: optionalNonEmptyString(),

  // Database Configuration
  DATABASE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  DEV_DATABASE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)), // For db-sync: development database URL
  PROD_DATABASE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)), // For db-sync: production database URL

  // API Gateway Configuration
  API_GATEWAY_PORT: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(SERVICE_DEFAULTS.API_GATEWAY_PORT),
  GATEWAY_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined))
    .transform(val => val ?? `http://localhost:${SERVICE_DEFAULTS.API_GATEWAY_PORT}`), // Internal URL for API calls (bot-client -> api-gateway)
  PUBLIC_GATEWAY_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)), // Public HTTPS URL for external resources (Discord avatar fetching)
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform(val => val?.split(',') ?? ['*'])
    .default(['*']),

  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // BYOK (Bring Your Own Key) Configuration
  API_KEY_ENCRYPTION_KEY: optionalEncryptionKey(), // 32-byte hex key for AES-256-GCM encryption

  // Optional Services
  ELEVENLABS_API_KEY: optionalNonEmptyString(),
  IMAGE_GENERATION_API_KEY: optionalNonEmptyString(),

  // Worker Configuration
  WORKER_CONCURRENCY: z.string().regex(/^\d+$/).transform(Number).default(5),
  QUEUE_NAME: z.string().default('ai-requests'),
  ENABLE_HEALTH_SERVER: z
    .string()
    .transform(val => val !== 'false')
    .default(true),
  PORT: z.string().regex(/^\d+$/).transform(Number).default(3001),
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
      const issues = error.issues
        .map(issue => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n');

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
 *
 * IMPORTANT: Call this in afterEach() to prevent test pollution
 */
export function resetConfig(): void {
  _config = undefined;
}

/**
 * Create config with custom values (for testing)
 * Uses safe test defaults instead of reading from process.env
 * This prevents test pollution and ensures isolated test environments
 */
export function createTestConfig(overrides: Partial<EnvConfig> = {}): EnvConfig {
  // Sensible test defaults (don't read from process.env!)
  const testDefaults: EnvConfig = {
    // Discord
    DISCORD_TOKEN: undefined,
    DISCORD_CLIENT_ID: undefined,
    GUILD_ID: undefined,
    AUTO_DEPLOY_COMMANDS: undefined,
    AUTO_TRANSCRIBE_VOICE: undefined,
    BOT_OWNER_ID: undefined,
    BOT_MENTION_CHAR: '@',
    INTERNAL_SERVICE_SECRET: undefined,

    // AI Provider
    AI_PROVIDER: AIProvider.OpenRouter,
    OPENROUTER_API_KEY: undefined,
    OPENROUTER_APP_TITLE: undefined,
    OPENAI_API_KEY: undefined,
    DEFAULT_AI_MODEL: MODEL_DEFAULTS.DEFAULT_MODEL,

    // AI Model Defaults
    WHISPER_MODEL: MODEL_DEFAULTS.WHISPER,
    VISION_FALLBACK_MODEL: MODEL_DEFAULTS.VISION_FALLBACK,

    // Redis
    REDIS_URL: undefined,
    REDIS_HOST: 'localhost',
    REDIS_PORT: SERVICE_DEFAULTS.REDIS_PORT,
    REDIS_PASSWORD: undefined,

    // Database
    DATABASE_URL: undefined,
    DEV_DATABASE_URL: undefined,
    PROD_DATABASE_URL: undefined,

    // API Gateway
    API_GATEWAY_PORT: SERVICE_DEFAULTS.API_GATEWAY_PORT,
    GATEWAY_URL: `http://localhost:${SERVICE_DEFAULTS.API_GATEWAY_PORT}`,
    PUBLIC_GATEWAY_URL: undefined,
    CORS_ORIGINS: ['*'],

    // Environment
    NODE_ENV: 'test',

    // Logging
    LOG_LEVEL: 'error', // Quiet logs in tests

    // BYOK
    API_KEY_ENCRYPTION_KEY: undefined,

    // Optional Services
    ELEVENLABS_API_KEY: undefined,
    IMAGE_GENERATION_API_KEY: undefined,

    // Worker
    WORKER_CONCURRENCY: 5,
    QUEUE_NAME: 'ai-requests',
    ENABLE_HEALTH_SERVER: false,
    PORT: 3001,
  };

  return { ...testDefaults, ...overrides };
}
