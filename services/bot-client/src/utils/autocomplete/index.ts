/**
 * Autocomplete Utilities
 *
 * Shared autocomplete handlers for consistent behavior across commands.
 * Uses caching to avoid HTTP requests on every keystroke.
 */

export { handlePersonalityAutocomplete } from './personalityAutocomplete.js';

export { handlePersonaAutocomplete, CREATE_NEW_PERSONA_VALUE } from './personaAutocomplete.js';
