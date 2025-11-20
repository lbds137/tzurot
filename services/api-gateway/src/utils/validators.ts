/**
 * Validation Utilities
 * Reusable validation functions for common request validation patterns
 */

import { customFieldsSchema } from '@tzurot/common-types';
import { ErrorResponses, type ErrorResponse } from './errorResponses.js';

/**
 * Validation result structure (discriminated union)
 */
export type ValidationResult =
  | { valid: true }
  | { valid: false; error: ErrorResponse };

/**
 * Validates a personality slug format
 * Slug must contain only lowercase letters, numbers, and hyphens
 *
 * @param slug - The slug to validate
 * @returns Validation result with error if invalid
 */
export function validateSlug(slug: string): ValidationResult {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return {
      valid: false,
      error: ErrorResponses.validationError(
        'Invalid slug format. Use only lowercase letters, numbers, and hyphens.'
      ),
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
