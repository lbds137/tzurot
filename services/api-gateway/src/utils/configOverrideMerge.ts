/**
 * Shared utility for merging partial config overrides into existing JSONB.
 * Used by both user config-overrides and admin settings routes.
 */

import {
  ConfigOverridesSchema,
  isNullTerminalField,
  CONFIG_WIRE_OFF,
} from '@tzurot/common-types/schemas/api/configOverrides';

/**
 * Merge partial config overrides into existing JSONB.
 * Validates input against ConfigOverridesSchema.partial(), merges with existing,
 * and strips cleared fields to keep JSONB clean.
 *
 * Wire contract per field:
 * - value            → set the override
 * - null             → clear the override (key removed from JSONB)
 * - CONFIG_WIRE_OFF  → explicit OFF for NULL_TERMINAL_FIELDS: persisted as stored
 *                      JSON null, which cascade resolution treats as terminal
 *                      (an OFF at any tier stops fall-through). On any other
 *                      field the sentinel fails schema validation → 'invalid'.
 *
 * @param existing - Current JSONB value from the database (may be null, non-object, etc.)
 * @param input - Partial config overrides to merge in
 * @returns Merged object, null if empty after merge, or 'invalid' if input fails validation
 */
/**
 * Normalize the wire shape for validation: null means "clear this override"
 * (→ undefined, so Zod's .optional() accepts it and the cleanup loop drops the
 * key), while CONFIG_WIRE_OFF on a null-terminal field becomes a null that
 * survives validation (the field is .nullable()) and the cleanup loop.
 */
function sanitizeWireInput(input: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === CONFIG_WIRE_OFF && isNullTerminalField(key)) {
      sanitized[key] = null;
    } else {
      sanitized[key] = value === null ? undefined : value;
    }
  }
  return sanitized;
}

export function mergeConfigOverrides(
  existing: unknown,
  input: Record<string, unknown>
): Record<string, unknown> | null | 'invalid' {
  const parseResult = ConfigOverridesSchema.partial().safeParse(sanitizeWireInput(input));
  if (!parseResult.success) {
    return 'invalid';
  }

  const existingObj =
    existing !== null && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  const merged: Record<string, unknown> = { ...existingObj, ...parseResult.data };

  // Remove undefined/cleared fields to keep JSONB clean. Null survives ONLY on
  // null-terminal fields (explicit OFF — from this write's sentinel mapping or a
  // prior OFF already persisted in `existing`); null anywhere else is legacy dirt
  // and is stripped as before. Clears can't reach here as null: input null was
  // normalized to undefined above, and undefined overwrites the existing value
  // in the spread.
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined || (merged[key] === null && !isNullTerminalField(key))) {
      delete merged[key];
    }
  }

  return Object.keys(merged).length > 0 ? merged : null;
}
