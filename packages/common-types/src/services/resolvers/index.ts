/**
 * Configuration Resolvers
 *
 * Shared resolvers for cascading configuration resolution with caching.
 */

export { BaseConfigResolver, type ResolutionResult } from './BaseConfigResolver.js';
export {
  PersonaResolver,
  type ResolvedPersona,
  type PersonaMemoryInfo,
} from './PersonaResolver.js';
export {
  resolveExtendedContextSettings,
  resolveExtendedContextEnabled,
  resolveNumericLimit,
  resolveMaxAge,
  toLevelSettings,
  toGlobalSettings,
  EXTENDED_CONTEXT_LIMITS,
  type GlobalSettings,
} from './ExtendedContextSettingsResolver.js';
