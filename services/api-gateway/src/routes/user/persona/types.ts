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
 * Request body for creating a persona
 */
export interface CreatePersonaBody {
  name: string;
  preferredName?: string;
  description?: string;
  content: string;
  pronouns?: string;
}

/**
 * Request body for updating a persona
 */
export interface UpdatePersonaBody {
  name?: string;
  preferredName?: string;
  description?: string;
  content?: string;
  pronouns?: string;
}

/**
 * Request body for settings update
 */
export interface SettingsBody {
  shareLtmAcrossPersonalities: boolean;
}

/**
 * Request body for persona override
 */
export interface OverrideBody {
  personaId: string;
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
