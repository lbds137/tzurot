import { z } from 'zod';
import { SERVICE_DEFAULTS, AIProvider } from '../constants/index.js';

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
  // Runtime-tunable operational knobs (extraction flags/model/provider, the
  // free-tier fair-share + z.ai piggyback quotas, model floors, the public
  // rate limit) live in the system-settings bag (`admin_settings.system_settings`),
  // NOT here — see SYSTEM_SETTINGS_REGISTRY. Only secrets and infra wiring stay env.
  EXTRACTION_DAILY_LIMIT: z.coerce.number().int().min(1).default(100), // per-personality daily ceiling on extraction model calls (cost tripwire)
  ZAI_CODING_API_KEY: optionalNonEmptyString(), // SYSTEM z.ai coding-plan key — secrets never move to the DB bag
  BOT_OWNER_ID: optionalDiscordId(), // Discord user ID of bot owner for admin commands
  /** Private owner channel receiving one silent embed per accepted /feedback
   *  submission. Unset → submissions are stored but not posted anywhere. */
  FEEDBACK_CHANNEL_ID: optionalDiscordId(),
  BOT_MENTION_CHAR: z.string().length(1).default('@'), // Character used for personality mentions (@personality or &personality)
  INTERNAL_SERVICE_SECRET: optionalNonEmptyString(), // Shared secret for service-to-service auth (bot-client -> api-gateway)

  // AI Provider Configuration
  AI_PROVIDER: z.nativeEnum(AIProvider).default(AIProvider.OpenRouter),
  OPENROUTER_API_KEY: optionalNonEmptyString(),
  OPENROUTER_APP_TITLE: optionalNonEmptyString(),
  OPENROUTER_APP_URL: optionalNonEmptyString(),
  // Note: model floors (fallbackTextModel/fallbackVisionModel + free floors)
  // are system settings; embeddings are local (Xenova/bge-small-en-v1.5) - no env config needed

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

  // Voice Engine (self-hosted STT/TTS service)
  VOICE_ENGINE_URL: optionalNonEmptyString(), // e.g., https://voice-engine-production.up.railway.app
  VOICE_ENGINE_API_KEY: optionalNonEmptyString(), // Shared secret for voice-engine auth

  // Worker Configuration
  WORKER_CONCURRENCY: z.string().regex(/^\d+$/).transform(Number).default(5),
  QUEUE_NAME: z.string().default('ai-requests'),

  // Outbound DM Safety
  /**
   * Comma-separated Discord user IDs the bot may proactively contact
   * (DM prewarming, broadcast delivery, future outbound DMs). Unset = no
   * restriction (prod). Set on DEV, whose db-synced user table is
   * prod-shaped: without it, boot-time DM prewarms and broadcasts reach
   * out to prod users from the dev bot — the burst pattern behind
   * Discord's 340002 DM quarantine.
   */
  OUTBOUND_DM_ALLOWLIST: z.string().optional(),

  // GitHub Release Pipeline
  /**
   * HMAC secret shared with the GitHub repo webhook (x-hub-signature-256).
   * Unset = the /webhooks/github/release endpoint rejects with 503.
   */
  GITHUB_WEBHOOK_SECRET: optionalNonEmptyString(),
  /**
   * Fine-grained PAT (Contents: Read-only) for the release reconcile sweep's
   * GitHub API reads. Optional — unauthenticated works, but Railway's shared
   * egress IPs make the 60 req/hr/IP anonymous limit unreliable. Deliberately
   * NOT named GITHUB_TOKEN: GitHub Actions auto-injects that name into CI env.
   */
  GITHUB_API_TOKEN: optionalNonEmptyString(),
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
          'Please check your .env file and ensure all required variables are set.',
        { cause: error }
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
    EXTRACTION_DAILY_LIMIT: 100,
    ZAI_CODING_API_KEY: undefined,
    BOT_OWNER_ID: undefined,
    FEEDBACK_CHANNEL_ID: undefined,
    BOT_MENTION_CHAR: '@',
    INTERNAL_SERVICE_SECRET: undefined,

    // AI Provider
    AI_PROVIDER: AIProvider.OpenRouter,
    OPENROUTER_API_KEY: undefined,
    OPENROUTER_APP_TITLE: undefined,
    OPENROUTER_APP_URL: undefined,

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

    // GitHub Release Pipeline
    GITHUB_WEBHOOK_SECRET: undefined,
    GITHUB_API_TOKEN: undefined,

    // Voice Engine
    VOICE_ENGINE_URL: undefined,
    VOICE_ENGINE_API_KEY: undefined,

    // Worker
    WORKER_CONCURRENCY: 5,
    QUEUE_NAME: 'ai-requests',
    ENABLE_HEALTH_SERVER: false,
    PORT: 3001,
  };

  return { ...testDefaults, ...overrides };
}
