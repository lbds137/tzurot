/**
 * Dashboard Framework
 *
 * Reusable components for entity editing dashboards in Discord.
 * Implements the "Seed & Edit" pattern to work within Discord's
 * modal limitations (5 fields max per modal).
 *
 * Pattern Overview:
 * 1. User triggers command → Minimal seed modal creates record
 * 2. Dashboard embed shows entity status with section indicators
 * 3. Select menu lets user pick section to edit
 * 4. Section modal opens with pre-filled values
 * 5. On submit, dashboard refreshes with updated data
 *
 * Usage:
 * 1. Define a DashboardConfig for your entity type
 * 2. Use buildDashboardEmbed/Components to render
 * 3. Use buildSectionModal to create edit modals
 * 4. Use SessionManager to track active editing sessions
 */

// Types
export {
  SectionStatus,
  STATUS_EMOJI,
  type DashboardContext,
  type ContextAware,
  resolveContextAware,
  type FieldDefinition,
  type SectionDefinition,
  type ActionDefinition,
  type DashboardConfig,
  type DashboardSession,
  type DashboardUpdateResult,
  type EditSelectionHandler,
  type ModalSubmitHandler,
  type ActionHandler,
  type DashboardRepository,
  type BrowseContext,
  isDashboardInteraction,
  parseDashboardCustomId,
  buildDashboardCustomId,
} from './types.js';

// Dashboard Builder
export {
  buildDashboardEmbed,
  buildEditMenu,
  buildActionButtons,
  buildDashboardComponents,
  getOverallStatus,
  type ActionButtonOptions,
} from './DashboardBuilder.js';

// Modal Factory
export {
  buildSectionModal,
  buildSimpleModal,
  extractModalValues,
  validateModalValues,
} from './ModalFactory.js';

// Session Manager
export {
  DashboardSessionManager,
  initSessionManager,
  getSessionManager,
  isSessionManagerInitialized,
  shutdownSessionManager,
  type SetSessionOptions,
} from './SessionManager.js';

// Messages
export {
  DASHBOARD_MESSAGES,
  formatSessionExpiredMessage,
  formatNotFoundMessage,
} from './messages.js';

// Close Handler
export { handleDashboardClose, createCloseHandler } from './closeHandler.js';
