/**
 * Shared Zod schemas for API responses
 *
 * Common schemas used across multiple API endpoints.
 */

import { z } from 'zod';

// ===========================================
// EMPTY STRING HANDLING
// ===========================================

/**
 * Preprocess empty/whitespace strings to undefined.
 *
 * This is the STANDARD way to handle optional string fields from form inputs.
 * When users clear a field in a modal, the client often sends "" instead of
 * omitting the field. This transform lets `.optional()` work correctly.
 *
 * IMPORTANT: Use with `.optional()` on the INNER schema, not the outer result.
 *
 * @example
 * ```typescript
 * const schema = emptyToUndefined(z.string().min(1).optional());
 * schema.parse("");      // undefined
 * schema.parse("hello"); // "hello"
 * ```
 */
export function emptyToUndefined<T extends z.ZodTypeAny>(schema: T): z.ZodType<z.infer<T>> {
  return z.preprocess(val => {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    }
    return val;
  }, schema);
}

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
export function optionalString(maxLength = 100): z.ZodType<string | undefined> {
  // Use union: either undefined (from empty), or a valid string
  // The preprocess converts empty → undefined, then union accepts either
  return z.preprocess(
    val => {
      if (typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed.length === 0 ? undefined : trimmed;
      }
      return val;
    },
    z.union([z.undefined(), z.string().min(1).max(maxLength)])
  );
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
export function nullableString(maxLength = 500): z.ZodType<string | null | undefined> {
  // Preprocess converts empty → null, then schema accepts string|null|undefined
  return z.preprocess(
    val => {
      if (typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed.length === 0 ? null : trimmed;
      }
      return val;
    },
    z.union([z.null(), z.undefined(), z.string().max(maxLength)])
  );
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
export type EntityPermissionsDto = z.infer<typeof EntityPermissionsSchema>;
