/**
 * PersonalityService - Backward Compatibility Re-export
 *
 * This file maintains backward compatibility with existing imports.
 * All functionality has been refactored into focused modules in ./personality/
 *
 * New code should import from './personality/index.js' for better tree-shaking.
 */

export {
  PersonalityService,
  PersonalityLoader,
  LlmConfigSchema,
  parseLlmConfig,
  replacePlaceholders,
  deriveAvatarUrl,
  mapToPersonality,
  type LlmConfig,
  type DatabasePersonality,
} from './personality/index.js';
