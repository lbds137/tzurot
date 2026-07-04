/**
 * Shared Zod schemas for API responses
 *
 * Common schemas used across multiple API endpoints.
 */

import { z } from 'zod';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ZodSchemas');

// ===========================================
// EMPTY STRING HANDLING
// ===========================================

/**
 * Preprocess empty/whitespace strings to null.
 *
 * Use for nullable fields where empty input should explicitly set null
 * (e.g., clearing an optional description).
 *
 * @example
 * ```typescript
 * const schema = emptyToNull(z.string().nullable());
 * schema.parse("");   // null
 * schema.parse("hi"); // "hi"
 * ```
 */
export function emptyToNull<T extends z.ZodTypeAny>(schema: T): z.ZodType<z.infer<T>> {
  return z.preprocess(val => {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      return trimmed.length === 0 ? null : trimmed;
    }
    return val;
  }, schema);
}

/**
 * Create an optional string field that handles empty inputs correctly.
 *
 * Behavior:
 * - Empty/whitespace string → undefined (field not updated)
 * - Valid non-empty string → validated and trimmed
 * - undefined → undefined (field not updated)
 *
 * @param maxLength Maximum string length (default: 100)
 * @example
 * ```typescript
 * const MySchema = z.object({
 *   name: optionalString(100),  // Empty → undefined, validated if present
 * });
 * ```
 */
export function optionalString(maxLength = 100): z.ZodOptional<z.ZodType<string | undefined>> {
  // Use union: either undefined (from empty), or a valid string
  // The preprocess converts empty → undefined, then union accepts either.
  // The outer .optional() doesn't change runtime behavior (undefined already
  // passes the union) — it marks the KEY optional in z.infer'd object types,
  // so update-payload types allow omitting fields instead of requiring
  // explicit `name: undefined` entries.
  const inner: z.ZodType<string | undefined> = z.preprocess(
    val => {
      if (typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed.length === 0 ? undefined : trimmed;
      }
      // Non-string values (numbers, objects, etc.) become undefined for safety
      if (val !== undefined) {
        logger.warn(
          { receivedType: typeof val, receivedValue: val },
          '[ZodSchemas] optionalString received non-string value, coercing to undefined'
        );
        return undefined;
      }
      return val;
    },
    z.union([z.undefined(), z.string().min(1).max(maxLength)])
  );
  return inner.optional();
}

/**
 * Create a nullable string field that handles empty inputs correctly.
 *
 * Behavior:
 * - Empty/whitespace input → null (field is explicitly set to null)
 * - Valid non-empty string → validated and trimmed
 * - null → null (field is explicitly set to null)
 * - undefined → undefined (field is not updated)
 *
 * @param maxLength Maximum string length (default: 500)
 * @example
 * ```typescript
 * const MySchema = z.object({
 *   description: nullableString(500),  // Empty → null, validated if present
 * });
 * ```
 */
export function nullableString(
  maxLength = 500
): z.ZodOptional<z.ZodType<string | null | undefined>> {
  // Preprocess converts empty → null, then schema accepts string|null|undefined.
  // The outer .optional() marks the KEY optional in z.infer'd object types —
  // see optionalString above for the rationale; runtime behavior is unchanged.
  const inner: z.ZodType<string | null | undefined> = z.preprocess(
    val => {
      if (typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed.length === 0 ? null : trimmed;
      }
      // Non-string values (numbers, objects, etc.) become undefined for safety
      // (preserves existing value rather than inadvertently clearing)
      if (val !== null && val !== undefined) {
        logger.warn(
          { receivedType: typeof val, receivedValue: val },
          '[ZodSchemas] nullableString received non-string value, coercing to undefined'
        );
        return undefined;
      }
      return val;
    },
    z.union([z.null(), z.undefined(), z.string().min(1).max(maxLength)])
  );
  return inner.optional();
}

// ===========================================
// ENTITY SCHEMAS
// ===========================================

/**
 * Standard entity permissions schema
 * Used for personalities, LLM configs, personas, etc.
 */
export const EntityPermissionsSchema = z.object({
  /** Whether the requesting user can edit this entity */
  canEdit: z.boolean(),
  /** Whether the requesting user can delete this entity */
  canDelete: z.boolean(),
});
