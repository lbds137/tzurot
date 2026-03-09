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
  ALL_SETTINGS,
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
