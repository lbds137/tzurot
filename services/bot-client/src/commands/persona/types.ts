/**
 * Persona Command Types
 *
 * Type definitions for persona data used in the dashboard pattern.
 */

/**
 * API response type for persona list
 */
export interface PersonaSummary {
  id: string;
  name: string;
  preferredName: string | null;
  isDefault: boolean;
}

/**
 * API response type for persona details
 */
export interface PersonaDetails {
  id: string;
  name: string;
  description: string | null;
  preferredName: string | null;
  pronouns: string | null;
  content: string | null;
  isDefault: boolean;
}

/**
 * Flattened persona data for dashboard display
 * All fields are strings for form handling
 * Index signature allows usage with generic Record<string, unknown> types
 */
export interface FlattenedPersonaData {
  [key: string]: string | boolean;
  id: string;
  name: string;
  description: string;
  preferredName: string;
  pronouns: string;
  content: string;
  isDefault: boolean;
}

/**
 * API response type for creating/updating a persona
 */
export interface SavePersonaResponse {
  success: boolean;
  persona: PersonaDetails;
  setAsDefault?: boolean;
}
