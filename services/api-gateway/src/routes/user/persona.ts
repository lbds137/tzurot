/**
 * User Persona Routes - Re-export from modular structure
 *
 * This file maintains backwards compatibility.
 * See ./persona/ directory for the modular implementation.
 */

export { createPersonaRoutes } from './persona/index.js';
export type {
  PersonaSummary,
  PersonaDetails,
  CreatePersonaBody,
  UpdatePersonaBody,
  SettingsBody,
  OverrideBody,
  PersonaOverrideSummary,
} from './persona/index.js';
