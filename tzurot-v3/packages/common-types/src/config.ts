import { z } from 'zod';

/**
 * Environment variable validation schema
 * Validates all required configuration at startup
 */
export const envSchema = z.object({
  // Discord Configuration
  DISCORD_TOKEN: z.string().min(1, 'Discord token is required'),
  
  // AI Provider Configuration
  AI_PROVIDER: z.enum(['openrouter', 'openai', 'anthropic', 'local']).default('openrouter'),
  OPENROUTER_API_KEY: z.string().min(1, 'OpenRouter API key is required when using OpenRouter'),
  OPENROUTER_BASE_URL: z.string().url().optional().default('https://openrouter.ai/api/v1'),
  DEFAULT_AI_MODEL: z.string().optional().default('anthropic/claude-3.5-sonnet'),
  
  // Redis Configuration (for BullMQ)
  REDIS_URL: z.string().url().optional().default('redis://localhost:6379'),
  
  // API Gateway Configuration
  API_GATEWAY_PORT: z.string().regex(/^\d+$/).transform(Number).default('3000'),
  API_GATEWAY_URL: z.string().url().optional().default('http://localhost:3000'),
  
  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  
  // Optional Services
  ELEVENLABS_API_KEY: z.string().optional(),
  IMAGE_GENERATION_API_KEY: z.string().optional(),
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
 * Singleton config instance
 * Use this throughout the application
 */
let _config: EnvConfig | undefined;

export function getConfig(): EnvConfig {
  if (!_config) {
    _config = validateEnv();
  }
  return _config;
}