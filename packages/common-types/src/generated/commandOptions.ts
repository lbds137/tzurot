/**
 * Type-Safe Command Option Schemas
 *
 * NOTE: This file is currently maintained manually.
 * Future: Auto-generate from SlashCommandBuilder definitions via `pnpm generate:command-types`
 *
 * Usage:
 * ```typescript
 * import { channelActivateOptions } from '@tzurot/common-types';
 *
 * async function handleActivate(context: SafeCommandContext) {
 *   const options = channelActivateOptions(context.interaction);
 *   const personality = options.personality(); // Type-safe: string
 * }
 * ```
 *
 * When to add schemas here:
 * - Commands where option name typos have caused bugs
 * - Commands with many options that are easy to confuse
 * - Any handler you want compile-time safety for
 */

import { defineTypedOptions } from '../utils/typedOptions.js';

// =============================================================================
// CHANNEL COMMAND
// =============================================================================

/**
 * /channel activate <personality>
 * Activates a personality in the current channel
 */
export const channelActivateOptions = defineTypedOptions({
  personality: { type: 'string', required: true },
});

/**
 * /channel deactivate <personality>
 * Deactivates a personality in the current channel
 */
export const channelDeactivateOptions = defineTypedOptions({
  personality: { type: 'string', required: true },
});

// =============================================================================
// MEMORY COMMAND
// =============================================================================

/**
 * /memory search <query> [personality]
 * Search memories with optional personality filter
 */
export const memorySearchOptions = defineTypedOptions({
  query: { type: 'string', required: true },
  personality: { type: 'string', required: false },
});

/**
 * /memory list [personality]
 * List memories for a personality
 */
export const memoryListOptions = defineTypedOptions({
  personality: { type: 'string', required: false },
});

// =============================================================================
// SETTINGS COMMAND
// =============================================================================

/**
 * /settings preset set <personality> <preset>
 * Set a preset override for a personality
 */
export const settingsPresetSetOptions = defineTypedOptions({
  personality: { type: 'string', required: true },
  preset: { type: 'string', required: true },
});

/**
 * /settings preset reset <personality>
 * Reset a preset override for a personality
 */
export const settingsPresetResetOptions = defineTypedOptions({
  personality: { type: 'string', required: true },
});

/**
 * /settings preset default <preset>
 * Set a default preset for all personalities
 */
export const settingsPresetDefaultOptions = defineTypedOptions({
  preset: { type: 'string', required: true },
});

/**
 * /settings timezone set <timezone>
 * Set user's timezone
 */
export const settingsTimezoneSetOptions = defineTypedOptions({
  timezone: { type: 'string', required: true },
});

// =============================================================================
// HISTORY COMMAND
// =============================================================================

/**
 * /history view [personality] [limit]
 * View conversation history
 */
export const historyViewOptions = defineTypedOptions({
  personality: { type: 'string', required: false },
  limit: { type: 'integer', required: false },
});

/**
 * /history clear <personality>
 * Clear conversation history for a personality
 */
export const historyClearOptions = defineTypedOptions({
  personality: { type: 'string', required: true },
});

// =============================================================================
// CHARACTER COMMAND
// =============================================================================

/**
 * /character chat <character> <message>
 * Start a chat with a character
 */
export const characterChatOptions = defineTypedOptions({
  character: { type: 'string', required: true },
  message: { type: 'string', required: true },
});

/**
 * /character view <character>
 * View character details
 */
export const characterViewOptions = defineTypedOptions({
  character: { type: 'string', required: true },
});

/**
 * /character edit <character>
 * Edit a character's settings
 */
export const characterEditOptions = defineTypedOptions({
  character: { type: 'string', required: true },
});

/**
 * /character avatar <character> [avatar]
 * Set a character's avatar
 */
export const characterAvatarOptions = defineTypedOptions({
  character: { type: 'string', required: true },
  avatar: { type: 'attachment', required: false },
});

// =============================================================================
// PERSONA COMMAND
// =============================================================================

/**
 * /persona view <persona>
 * View persona details
 */
export const personaViewOptions = defineTypedOptions({
  persona: { type: 'string', required: true },
});

/**
 * /persona edit <persona>
 * Edit a persona
 */
export const personaEditOptions = defineTypedOptions({
  persona: { type: 'string', required: true },
});

/**
 * /persona default <persona>
 * Set a default persona
 */
export const personaDefaultOptions = defineTypedOptions({
  persona: { type: 'string', required: true },
});

/**
 * /persona override set <personality> <persona>
 * Set a persona override for a personality
 */
export const personaOverrideSetOptions = defineTypedOptions({
  personality: { type: 'string', required: true },
  persona: { type: 'string', required: true },
});

/**
 * /persona override clear <personality>
 * Clear a persona override for a personality
 */
export const personaOverrideClearOptions = defineTypedOptions({
  personality: { type: 'string', required: true },
});

// =============================================================================
// PRESET COMMAND
// =============================================================================

/**
 * /preset view <preset>
 * View preset details
 */
export const presetViewOptions = defineTypedOptions({
  preset: { type: 'string', required: true },
});

/**
 * /preset edit <preset>
 * Edit a preset
 */
export const presetEditOptions = defineTypedOptions({
  preset: { type: 'string', required: true },
});
