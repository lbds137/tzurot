/**
 * Validation Utilities
 * Reusable validation functions for common request validation patterns
 */

import { customFieldsSchema } from '@tzurot/common-types';
import { ErrorResponses, type ErrorResponse } from './errorResponses.js';

/**
 * Validation result structure (discriminated union)
 */
type ValidationResult = { valid: true } | { valid: false; error: ErrorResponse };

/**
 * UUID regex pattern (validates format, not version)
 * Matches standard UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * Accepts any UUID version (v1-v5) - this project uses deterministic v5 UUIDs
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates UUID format (any version)
 *
 * @param id - The ID to validate (accepts undefined for route params)
 * @param fieldName - Name of the field for error message (default: 'ID')
 * @returns Validation result with error if invalid or missing
 */
export function validateUuid(id: string | undefined, fieldName = 'ID'): ValidationResult {
  if (id === undefined) {
    return {
      valid: false,
      error: ErrorResponses.validationError(`${fieldName} is required`),
    };
  }
  if (!UUID_REGEX.test(id)) {
    return {
      valid: false,
      error: ErrorResponses.validationError(`Invalid ${fieldName} format`),
    };
  }
  return { valid: true };
}

/** Reserved slugs that cannot be used for personalities/personas */
const RESERVED_SLUGS = new Set([
  'admin',
  'system',
  'default',
  'api',
  'bot',
  'help',
  'settings',
  'config',
  'me',
  'user',
  'users',
]);

/**
 * Validates a personality slug format
 * Slug must:
 * - Contain only lowercase letters, numbers, and hyphens
 * - Start and end with alphanumeric character (not hyphen)
 * - Not have consecutive hyphens
 * - Not be a reserved keyword
 * - Maximum length is 64 characters to prevent DoS attacks
 *
 * @param slug - The slug to validate (accepts undefined for route params)
 * @returns Validation result with error if invalid or missing
 */
export function validateSlug(slug: string | undefined): ValidationResult {
  // Check for undefined/missing
  if (slug === undefined) {
    return {
      valid: false,
      error: ErrorResponses.validationError('Slug is required'),
    };
  }

  // Check length (prevent DoS via extremely long slugs)
  if (slug.length === 0 || slug.length > 64) {
    return {
      valid: false,
      error: ErrorResponses.validationError('Slug must be between 1 and 64 characters'),
    };
  }

  // Check for reserved slugs
  if (RESERVED_SLUGS.has(slug.toLowerCase())) {
    return {
      valid: false,
      error: ErrorResponses.validationError(
        `"${slug}" is a reserved name and cannot be used as a slug.`
      ),
    };
  }

  // Check format (lowercase letters, numbers, hyphens only)
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return {
      valid: false,
      error: ErrorResponses.validationError(
        'Invalid slug format. Use only lowercase letters, numbers, and hyphens.'
      ),
    };
  }

  // Must start with alphanumeric (not hyphen)
  if (slug.startsWith('-')) {
    return {
      valid: false,
      error: ErrorResponses.validationError('Slug cannot start with a hyphen.'),
    };
  }

  // Must end with alphanumeric (not hyphen)
  if (slug.endsWith('-')) {
    return {
      valid: false,
      error: ErrorResponses.validationError('Slug cannot end with a hyphen.'),
    };
  }

  // No consecutive hyphens
  if (slug.includes('--')) {
    return {
      valid: false,
      error: ErrorResponses.validationError('Slug cannot contain consecutive hyphens.'),
    };
  }

  return { valid: true };
}

/**
 * Validates customFields using Zod schema
 * CustomFields must be a record of string keys to unknown values, or null/undefined
 *
 * @param fields - The customFields to validate
 * @returns Validation result with error if invalid
 */
export function validateCustomFields(fields: unknown): ValidationResult {
  // null and undefined are valid (optional field)
  if (fields === undefined || fields === null) {
    return { valid: true };
  }

  const validation = customFieldsSchema.safeParse(fields);
  if (!validation.success) {
    return {
      valid: false,
      error: ErrorResponses.validationError(`Invalid customFields: ${validation.error.message}`),
    };
  }

  return { valid: true };
}

/**
 * Validates that a required field is present and not empty
 *
 * @param value - The value to check
 * @param fieldName - Name of the field for error message
 * @returns Validation result with error if missing/empty
 */
export function validateRequired(value: unknown, fieldName: string): ValidationResult {
  if (value === undefined || value === null || value === '') {
    return {
      valid: false,
      error: ErrorResponses.validationError(`${fieldName} is required`),
    };
  }
  return { valid: true };
}

/**
 * Validates a string length is within bounds
 *
 * @param value - The string to validate
 * @param fieldName - Name of the field for error message
 * @param min - Minimum length (inclusive)
 * @param max - Maximum length (inclusive)
 * @returns Validation result with error if out of bounds
 */
export function validateStringLength(
  value: string,
  fieldName: string,
  min: number,
  max: number
): ValidationResult {
  if (value.length < min || value.length > max) {
    return {
      valid: false,
      error: ErrorResponses.validationError(
        `${fieldName} must be between ${min} and ${max} characters`
      ),
    };
  }
  return { valid: true };
}
