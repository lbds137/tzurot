/**
 * Type guard utilities for runtime type checking and assertions
 */

/**
 * Assert that a value is defined (not undefined).
 * Throws an error if the value is undefined, otherwise narrows the type.
 *
 * @param value - The value to check
 * @param fieldName - The name of the field (for error messages)
 * @throws Error if value is undefined
 *
 * @example
 * ```typescript
 * const name: string | undefined = req.body.name;
 * assertDefined(name, 'name');
 * // TypeScript now knows name is string (not string | undefined)
 * const upperName = name.toUpperCase(); // No type error
 * ```
 */
export function assertDefined<T>(value: T | undefined, fieldName: string): asserts value is T {
  if (value === undefined) {
    throw new Error(`Validation passed but ${fieldName} is missing`);
  }
}

/**
 * Assert that a value is not null.
 * Throws an error if the value is null, otherwise narrows the type.
 *
 * @param value - The value to check
 * @param fieldName - The name of the field (for error messages)
 * @throws Error if value is null
 */
export function assertNotNull<T>(value: T | null, fieldName: string): asserts value is T {
  if (value === null) {
    throw new Error(`Validation passed but ${fieldName} is null`);
  }
}

/**
 * Assert that a value is neither null nor undefined.
 * Throws an error if the value is null or undefined, otherwise narrows the type.
 *
 * @param value - The value to check
 * @param fieldName - The name of the field (for error messages)
 * @throws Error if value is null or undefined
 */
export function assertExists<T>(
  value: T | null | undefined,
  fieldName: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(`Validation passed but ${fieldName} is missing or null`);
  }
}
