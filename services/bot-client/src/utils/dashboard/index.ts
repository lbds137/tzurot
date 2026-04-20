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
  type DashboardContext,
  type SectionDefinition,
  type DashboardConfig,
  type BrowseContext,
  isDashboardInteraction,
  parseDashboardCustomId,
  buildDashboardCustomId,
} from './types.js';

// Dashboard Builder
export {
  buildDashboardEmbed,
  buildDashboardComponents,
  type ActionButtonOptions,
} from './DashboardBuilder.js';

// Modal Factory
export { buildSectionModal, extractModalValues } from './ModalFactory.js';

// Session Manager
export { initSessionManager, getSessionManager, shutdownSessionManager } from './SessionManager.js';

// Messages
export {
  DASHBOARD_MESSAGES,
  formatSessionExpiredMessage,
  formatSuccessBanner,
} from './messages.js';

// Close Handler
export { handleDashboardClose } from './closeHandler.js';

// Terminal Screen Renderer
export {
  renderTerminalScreen,
  type BrowseCapableEntityType,
  type TerminalScreenOptions,
  type TerminalScreenSession,
} from './terminalScreen.js';

// Post-Action Screen (hybrid success=rebuild / error=terminal dispatcher)
export {
  renderPostActionScreen,
  type PostActionOutcome,
  type PostActionScreenOptions,
} from './postActionScreen.js';

// Shared Back-to-Browse button handler (used by renderTerminalScreen's back
// button + renderPostActionScreen's error fallback). PR 2 wires per-command
// back-button routers to this.
export { handleSharedBackButton } from './sharedBackButtonHandler.js';

// Browse-rebuilder registry — command browse modules call
// `registerBrowseRebuilder` at module-load time; helpers above look up by
// entity type. `clearBrowseRegistry` is intentionally NOT re-exported here:
// it's a test-only helper and tests import from the source module directly.
export {
  registerBrowseRebuilder,
  getBrowseRebuilder,
  type BrowseRebuilder,
  type BrowseRebuildResult,
} from './browseRebuilderRegistry.js';

// Session Helpers
export {
  fetchOrCreateSession,
  requireDeferredSession,
  getSessionOrExpired,
  getSessionDataOrReply,
} from './sessionHelpers.js';

// Modal Helpers
export { extractAndMergeSectionValues } from './modalHelpers.js';

// Delete confirmation
export { buildDeleteConfirmation } from './deleteConfirmation.js';

// Permission Checks
export { checkOwnership } from './permissionChecks.js';
