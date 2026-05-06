/**
 * Truncation Gate — over-length field detection.
 *
 * Generic over the section's flat data type so multiple dashboards can
 * use the same detection logic against their own typed data shapes
 * (CharacterData, FlattenedPersonaData, future entity types).
 */

import type { SectionDefinition } from '../types.js';

/**
 * A field whose current value exceeds its modal maxLength.
 */
export interface OverLengthField {
  /** The field id (matches the data object key) */
  fieldId: string;
  /** The user-facing label */
  label: string;
  /** Current character count */
  current: number;
  /** Configured maxLength — what the edit modal will truncate down to */
  max: number;
}

/**
 * Scan a section's fields and report any whose current value exceeds
 * the modal's maxLength constraint.
 *
 * `maxLength` is a required field on `FieldDefinition` (see
 * `utils/dashboard/types.ts`), so every field always has an explicit
 * cap to check against.
 */
export function detectOverLengthFields<T>(
  section: SectionDefinition<T>,
  data: T
): OverLengthField[] {
  const over: OverLengthField[] = [];
  for (const field of section.fields) {
    const raw = (data as Record<string, unknown>)[field.id];
    if (typeof raw !== 'string') {
      continue;
    }
    if (raw.length > field.maxLength) {
      over.push({
        fieldId: field.id,
        label: field.label,
        current: raw.length,
        max: field.maxLength,
      });
    }
  }
  return over;
}
