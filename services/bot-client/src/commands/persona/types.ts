/**
 * Persona Command Types
 *
 * Type definitions for persona data used in the dashboard pattern.
 */

import type { BrowseContext } from '../../utils/dashboard/types.js';

/**
 * API response type for persona list
 */
export interface PersonaSummary {
  id: string;
  name: string;
  preferredName: string | null;
  isDefault: boolean;
  createdAt: string;
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
 * Browse context specific to persona browse
 */
export interface PersonaBrowseContext extends BrowseContext {
  sort: 'name' | 'date';
}

/**
 * Flattened persona data for dashboard display
 * All fields are strings for form handling
 * Index signature uses `unknown` for Record<string, unknown> compatibility
 */
export interface FlattenedPersonaData {
  [key: string]: unknown;
  id: string;
  name: string;
  description: string;
  preferredName: string;
  pronouns: string;
  content: string;
  isDefault: boolean;
  /** Browse context when opened from browse (for back navigation) */
  browseContext?: PersonaBrowseContext;
}

/**
 * API response type for creating/updating a persona
 */
export interface SavePersonaResponse {
  success: boolean;
  persona: PersonaDetails;
  setAsDefault?: boolean;
}
