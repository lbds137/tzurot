/**
 * JSON Sanitizer for PostgreSQL JSONB
 *
 * Ensures objects can be safely stored in PostgreSQL JSONB columns by:
 * 1. Using native `toWellFormed()` to replace lone surrogates (Node 20+)
 * 2. Removing NULL bytes (\u0000) which PostgreSQL rejects
 *
 * This is necessary because PostgreSQL's JSONB parser is stricter than JavaScript's
 * and will reject malformed Unicode sequences that JavaScript tolerates.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/toWellFormed
 */

/**
 * Recursively sanitize an object for safe JSONB storage.
 *
 * Uses the native `String.prototype.toWellFormed()` method (Node 20+) to fix
 * lone surrogates, which occur when LLM streams get cut off mid-emoji or when
 * data contains malformed Unicode.
 *
 * @param value - The value to sanitize (can be any JSON-serializable type)
 * @returns A sanitized copy safe for JSONB storage
 */
export function sanitizeForJsonb<T>(value: T): T {
  // Handle null/undefined early
  if (value === null || value === undefined) {
    return value;
  }

  // Handle strings - the main case we're fixing
  if (typeof value === 'string') {
    // toWellFormed() replaces lone surrogates with U+FFFD (replacement character)
    // Then strip null bytes which PostgreSQL also rejects
    return value.toWellFormed().replace(/\0/g, '') as T;
  }

  // Handle other primitives (numbers, booleans)
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item: unknown) => sanitizeForJsonb(item)) as T;
  }

  // Handle objects (excluding null, already handled above)
  if (typeof value === 'object') {
    // Handle Date objects - convert to ISO string
    if (value instanceof Date) {
      return value.toISOString() as T;
    }

    // Regular objects - recursively sanitize
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = sanitizeForJsonb(val);
    }
    return sanitized as T;
  }

  // For any other type (functions, symbols, etc.), return as-is
  // These will be handled by JSON.stringify (functions become undefined, etc.)
  return value;
}
