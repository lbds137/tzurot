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
  // Convert null values to undefined before validation.
  // Dashboard "auto" buttons send null to mean "clear this override" — Zod's .optional()
  // accepts undefined but not null, so we normalize here. The cleanup loop below then
  // removes undefined keys from the merged result, effectively clearing the override.
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    sanitized[key] = value === null ? undefined : value;
  }

  const parseResult = ConfigOverridesSchema.partial().safeParse(sanitized);
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
