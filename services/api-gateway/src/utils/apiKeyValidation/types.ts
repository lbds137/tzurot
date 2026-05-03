/**
 * Shared types and constants for API key validation.
 *
 * Each provider validator (openrouter.ts, elevenlabs.ts, etc.) imports
 * from here so the result shape and error vocabulary stay consistent.
 * The dispatcher in `../apiKeyValidation.ts` re-exports the public types
 * for callers that don't care about the per-provider files.
 */

/** Error codes returned from validation. */
export type ValidationErrorCode =
  | 'INVALID_KEY'
  | 'MISSING_PERMISSIONS'
  | 'QUOTA_EXCEEDED'
  | 'TIMEOUT'
  | 'UNKNOWN';

/** Result of API key validation. */
export interface ApiKeyValidationResult {
  /** Whether the key is valid */
  valid: boolean;
  /** Credit balance (if available from provider) */
  credits?: number;
  /** Error message if validation failed */
  error?: string;
  /** Error classification code */
  errorCode?: ValidationErrorCode;
}

/** Shared error messages used by every provider validator. */
export const VALIDATION_MESSAGES = {
  INVALID_KEY: 'Invalid API key',
  TIMEOUT: 'Validation request timed out',
  FALLBACK: 'Validation failed',
  QUOTA_EXCEEDED_ZAI: 'z.ai coding-plan quota exhausted for the current period',
} as const;
