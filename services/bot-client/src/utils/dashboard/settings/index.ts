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
  type SettingUpdateResult,
  type SettingValue,
  parseSettingsCustomId,
  isSettingsInteraction,
} from './types.js';

// Configuration
export { EXTENDED_CONTEXT_SETTINGS, MEMORY_SETTINGS } from './settingsConfig.js';

// Dashboard Builder
// Modal Factory
// Dashboard Handler
export {
  createSettingsDashboard,
  handleSettingsSelectMenu,
  handleSettingsButton,
  handleSettingsModal,
} from './SettingsDashboardHandler.js';
