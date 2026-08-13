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
 * Get list of field labels that CARRIED A VALUE in the import payload.
 * Used to build "imported fields" summary in success messages.
 *
 * Empty strings and empty arrays are excluded: character exports emit those
 * as explicit clear instructions for fields the character doesn't have, and
 * listing a cleared field under "Imported Fields" tells the user content
 * arrived when none did.
 */
export function getImportedFieldsList(
  payload: Record<string, unknown>,
  fieldDefs: ImportFieldDef[]
): string[] {
  return fieldDefs
    .filter(({ key }) => {
      const value = payload[key];
      if (value === undefined || value === null || value === '') {
        return false;
      }
      return !(Array.isArray(value) && value.length === 0);
    })
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
