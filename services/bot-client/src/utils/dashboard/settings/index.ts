/**
 * Settings Dashboard Module
 *
 * Provides interactive settings dashboards with button-based UIs.
 * Used by /admin settings, /channel context, and /character settings.
 */

// Types
export {
  SettingType,
  DashboardView,
  type SettingSource,
  type SettingDefinition,
  type SettingValue,
  type SettingsData,
  type DashboardLevel,
  type SettingsDashboardSession,
  type SettingsDashboardConfig,
  type SettingUpdateResult,
  type SettingUpdateHandler,
  buildSettingsCustomId,
  parseSettingsCustomId,
  isSettingsInteraction,
  SETTINGS_CUSTOM_ID_DELIMITER,
} from './types.js';

// Configuration
export { EXTENDED_CONTEXT_SETTINGS, getSettingDefinition } from './settingsConfig.js';

// Dashboard Builder
export {
  buildOverviewEmbed,
  buildSettingEmbed,
  buildSettingsSelectMenu,
  buildTriStateButtons,
  buildEditButtons,
  buildBackButton,
  buildCloseButton,
  buildOverviewMessage,
  buildSettingMessage,
  getSettingById,
} from './SettingsDashboardBuilder.js';

// Modal Factory
export {
  buildSettingEditModal,
  parseNumericInput,
  parseDurationInput,
} from './SettingsModalFactory.js';

// Dashboard Handler
export {
  createSettingsDashboard,
  handleSettingsSelectMenu,
  handleSettingsButton,
  handleSettingsModal,
  getUpdateHandler,
  type CreateDashboardOptions,
} from './SettingsDashboardHandler.js';
