/**
 * Shared import validation helpers.
 *
 * Used by character/import.ts and preset/import.ts for
 * common field-presence checking and field-list display.
 */

export interface ImportFieldDef {
  key: string;
  label: string;
}

/**
 * Get list of field labels present in the import payload.
 * Used to build "imported fields" summary in success messages.
 */
export function getImportedFieldsList(
  payload: Record<string, unknown>,
  fieldDefs: ImportFieldDef[]
): string[] {
  return fieldDefs
    .filter(({ key }) => payload[key] !== undefined && payload[key] !== null)
    .map(({ label }) => label);
}

/**
 * Get list of required field keys missing from the payload.
 * Used to validate that required fields are present and non-empty.
 */
export function getMissingRequiredFields(
  data: Record<string, unknown>,
  requiredFields: string[]
): string[] {
  return requiredFields.filter(
    field => data[field] === undefined || data[field] === null || data[field] === ''
  );
}
