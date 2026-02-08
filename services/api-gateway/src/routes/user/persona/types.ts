/**
 * Shared types for persona routes
 */

/**
 * Persona summary for list responses
 */
export interface PersonaSummary {
  id: string;
  name: string;
  preferredName: string | null;
  description: string | null;
  pronouns: string | null;
  content: string | null;
  isDefault: boolean;
  shareLtmAcrossPersonalities: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Full persona details for single-item responses
 */
export interface PersonaDetails extends PersonaSummary {
  content: string;
  pronouns: string | null;
}

/**
 * Request body for settings update
 */
export interface SettingsBody {
  shareLtmAcrossPersonalities: boolean;
}

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
