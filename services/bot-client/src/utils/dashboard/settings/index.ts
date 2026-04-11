/**
 * Settings Dashboard Module
 *
 * Provides interactive settings dashboards with button-based UIs.
 * Used by /admin settings, /channel context, and /character settings.
 */

// Types
export {
  type SettingsData,
  type SettingsDashboardSession,
  type SettingsDashboardConfig,
  type SettingSource,
  type SettingUpdateHandler,
  type SettingUpdateResult,
  type SettingValue,
  type PersonalityResponse,
  parseSettingsCustomId,
  isSettingsInteraction,
} from './types.js';

// Configuration
export {
  EXTENDED_CONTEXT_SETTINGS,
  MEMORY_SETTINGS,
  DISPLAY_SETTINGS,
  VOICE_SETTINGS,
  VOICE_CASCADE_SETTINGS,
} from './settingsConfig.js';

// Shared update logic
export { mapSettingToApiUpdate } from './settingsUpdate.js';

// Shared data builder
export {
  buildCascadeSettingsData,
  buildFallbackSettingsData,
  convertResolveDefaultsResponse,
  type ResolveDefaultsResponse,
} from './settingsDataBuilder.js';

// Dashboard Builder
// Modal Factory
// Dashboard Handler
export {
  createSettingsDashboard,
  handleSettingsSelectMenu,
  handleSettingsButton,
  handleSettingsModal,
} from './SettingsDashboardHandler.js';

// Command Handler Factory — builds the 4-handler bundle (select/button/modal/guard)
// for entity-ID-based settings dashboards (character/overrides, character/settings,
// channel/settings). Collapses the ~19-line router pattern previously duplicated
// across each consumer.
export {
  createSettingsCommandHandlers,
  type SettingsCommandHandlerOptions,
  type SettingsCommandHandlers,
} from './createSettingsCommandHandlers.js';
