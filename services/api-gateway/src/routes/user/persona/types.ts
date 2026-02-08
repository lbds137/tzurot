/**
 * Shared types for persona routes
 *
 * Note: PersonaSummary, PersonaDetails, and SettingsBody have been moved to
 * @tzurot/common-types as Zod-inferred types from input/response schemas.
 */

/**
 * Persona override summary
 */
export interface PersonaOverrideSummary {
  personalityId: string;
  personalitySlug: string;
  personalityName: string;
  personaId: string;
  personaName: string;
}
