/**
 * Shared utilities for validated mock factories.
 *
 * Extracted from per-factory copies to eliminate duplication.
 */

/** Deep partial type for nested object overrides */
export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

/** Deep merge two objects, recursing into nested plain objects */
export function deepMerge<T>(base: T, overrides?: DeepPartial<T>): T {
  if (!overrides) {
    return base;
  }
  if (typeof base !== 'object' || base === null) {
    return base;
  }

  const result = { ...base } as Record<string, unknown>;

  for (const key of Object.keys(overrides)) {
    const overrideValue = overrides[key as keyof typeof overrides];
    if (overrideValue !== undefined) {
      const baseValue = result[key];
      if (
        typeof overrideValue === 'object' &&
        overrideValue !== null &&
        !Array.isArray(overrideValue) &&
        typeof baseValue === 'object' &&
        baseValue !== null
      ) {
        result[key] = deepMerge(baseValue, overrideValue as DeepPartial<typeof baseValue>);
      } else {
        result[key] = overrideValue;
      }
    }
  }

  return result as T;
}
