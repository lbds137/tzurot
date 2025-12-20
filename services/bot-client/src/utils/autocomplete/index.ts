/**
 * Autocomplete Utilities
 *
 * Shared autocomplete handlers for consistent behavior across commands.
 * Uses caching to avoid HTTP requests on every keystroke.
 */

export {
  handlePersonalityAutocomplete,
  getVisibilityIcon,
  type PersonalityAutocompleteOptions,
} from './personalityAutocomplete.js';

export {
  handlePersonaAutocomplete,
  CREATE_NEW_PERSONA_VALUE,
  type PersonaAutocompleteOptions,
} from './personaAutocomplete.js';

export { invalidateUserCache as invalidateAutocompleteCache } from './autocompleteCache.js';
