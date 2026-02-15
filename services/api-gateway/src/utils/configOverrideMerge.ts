/**
 * Shared utility for merging partial config overrides into existing JSONB.
 * Used by both user config-overrides and admin settings routes.
 */

import { ConfigOverridesSchema } from '@tzurot/common-types';

/**
 * Merge partial config overrides into existing JSONB.
 * Validates input against ConfigOverridesSchema.partial(), merges with existing,
 * and strips null/undefined fields to keep JSONB clean.
 *
 * @param existing - Current JSONB value from the database (may be null, non-object, etc.)
 * @param input - Partial config overrides to merge in
 * @returns Merged object, null if empty after merge, or 'invalid' if input fails validation
 */
export function mergeConfigOverrides(
  existing: unknown,
  input: Record<string, unknown>
): Record<string, unknown> | null | 'invalid' {
  const parseResult = ConfigOverridesSchema.partial().safeParse(input);
  if (!parseResult.success) {
    return 'invalid';
  }

  const existingObj =
    existing !== null && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  const merged: Record<string, unknown> = { ...existingObj, ...parseResult.data };

  // Remove undefined/null fields to keep JSONB clean
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined || merged[key] === null) {
      delete merged[key];
    }
  }

  return Object.keys(merged).length > 0 ? merged : null;
}
