/**
 * Wallet (BYOK) Constants
 *
 * Constants for API key management and BYOK operations.
 */

/**
 * Error messages for wallet operations
 */
export const WALLET_ERROR_MESSAGES = {
  /** Missing required fields in set key request */
  MISSING_FIELDS: 'provider and apiKey are required',

  /** Invalid provider specified - shows valid options */
  INVALID_PROVIDER: (provider: string) =>
    `Invalid provider: ${provider}. Supported providers: openrouter`,

  /** Generic invalid API key message */
  INVALID_API_KEY: 'Invalid API key',

  /** API key has insufficient credits */
  INSUFFICIENT_CREDITS: 'Insufficient credits',

  /** Generic validation failure */
  VALIDATION_FAILED: 'Validation failed',

  /** API key not found for user/provider */
  KEY_NOT_FOUND: 'API key not found for this provider',

  /** API key validation request timed out */
  VALIDATION_TIMEOUT: 'API key validation timed out',
} as const;

/**
 * API key format patterns and placeholders
 *
 * Note: Only OpenRouter is supported for user-facing BYOK. Other prefixes are
 * kept for log sanitization purposes (redacting leaked keys in error messages).
 */
export const API_KEY_FORMATS = {
  /** OpenRouter API key prefix */
  OPENROUTER_PREFIX: 'sk-or-',

  /** OpenRouter v1 API key prefix */
  OPENROUTER_V1_PREFIX: 'sk-or-v1-',

  /** Placeholder for displaying masked keys */
  MASKED_KEY: '••••••••••••••••',

  /** Placeholder example for OpenRouter keys (for documentation/UI) */
  OPENROUTER_PLACEHOLDER: 'sk-or-v1-xxxx...',
} as const;
