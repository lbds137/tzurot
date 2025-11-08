/**
 * Centralized Model Configuration
 *
 * Single source of truth for all AI model defaults.
 * This prevents inconsistencies across services and makes it easy to change defaults.
 */

export const MODEL_DEFAULTS = {
  // Main generation model (used when no model specified)
  DEFAULT_MODEL: 'anthropic/claude-haiku-4.5',

  // Specialized models
  WHISPER: 'whisper-1',
  VISION_FALLBACK: 'qwen/qwen3-vl-235b-a22b-instruct',
  EMBEDDING: 'text-embedding-3-small',
} as const;

/**
 * Model name type derived from defaults
 */
export type DefaultModelName = (typeof MODEL_DEFAULTS)[keyof typeof MODEL_DEFAULTS];
