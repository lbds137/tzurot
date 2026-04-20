/**
 * Dashboard Messages
 *
 * Standard message constants used across dashboard implementations.
 * Ensures consistent user-facing messages for common states.
 */

/**
 * Standard dashboard messages
 */
export const DASHBOARD_MESSAGES = {
  /** Message shown when session has expired */
  SESSION_EXPIRED: '⏰ Session expired. Please run the command again.',

  /** Message shown when dashboard is closed */
  DASHBOARD_CLOSED: '✅ Dashboard closed.',

  /** Message shown when entity is not found */
  NOT_FOUND: (entityType: string) => `❌ ${entityType} not found.`,

  /** Message shown when user lacks permission */
  NO_PERMISSION: (action: string) => `❌ You do not have permission to ${action}.`,

  /** Message shown when edit permission is denied */
  CANNOT_EDIT: '❌ You do not have permission to edit this.',

  /** Message shown when delete permission is denied */
  CANNOT_DELETE: '❌ You do not have permission to delete this.',

  /** Generic failure message */
  OPERATION_FAILED: (action: string) => `❌ Failed to ${action}. Please try again.`,

  /** Message shown when unknown section is selected */
  UNKNOWN_SECTION: '❌ Unknown section.',

  /** Message shown when unknown form is submitted */
  UNKNOWN_FORM: '❌ Unknown form submission.',

  /** Message shown during loading/processing */
  LOADING: (action: string) => `🔄 ${action}...`,

  /** Message shown on successful action */
  SUCCESS: (action: string) => `✅ ${action}`,

  /** Message for delete confirmation title */
  DELETE_CONFIRM_TITLE: (entityType: string) => `🗑️ Delete ${entityType}?`,

  /** Warning message for delete action */
  DELETE_WARNING: 'This action cannot be undone.',

  /** Button label for cancel */
  CANCEL_LABEL: 'Cancel',

  /** Button label for delete */
  DELETE_LABEL: 'Delete',

  /** Button label for confirm delete */
  DELETE_CONFIRM_LABEL: 'Delete Forever',
} as const;

/**
 * Format a session expired message with command hint
 */
export function formatSessionExpiredMessage(command: string): string {
  return `⏰ Session expired. Please run \`${command}\` again.`;
}

/**
 * Format a not found message for a specific entity
 */
export function formatNotFoundMessage(entityType: string, entityName?: string): string {
  if (entityName !== undefined) {
    return `❌ ${entityType} "${entityName}" not found.`;
  }
  return `❌ ${entityType} not found.`;
}

/**
 * Format a post-action success banner for Pattern B (direct re-render with a
 * short banner in `editReply.content`). Used by the hybrid post-action flow.
 *
 * Bright emoji + bold verb is deliberate: Discord's mobile client
 * de-emphasizes the `content` field when a large embed sits directly below,
 * so the banner has to be visually distinctive to remain scannable.
 *
 * @example
 *   formatSuccessBanner('Deleted', 'MyPreset') // '✅ **Deleted** · MyPreset'
 */
export function formatSuccessBanner(verb: string, entityName: string): string {
  return `✅ **${verb}** · ${entityName}`;
}
