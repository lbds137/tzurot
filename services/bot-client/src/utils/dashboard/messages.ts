/**
 * Dashboard Messages
 *
 * Standard message constants used across dashboard implementations. The
 * user-facing MESSAGE keys are rendered views of ux/catalog intents — the
 * catalog owns the wording and the renderer owns the glyphs; this module is
 * a convenience surface so dashboard call sites keep working unchanged.
 * New code should prefer building the intent and calling `replySpec`.
 *
 * The component-vocabulary keys (embed titles, button labels) are NOT
 * messages — they stay literal here until the component phase of the UX
 * design system gives them a home.
 */

import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';

/**
 * Standard dashboard messages
 */
export const DASHBOARD_MESSAGES = {
  /** Message shown when session has expired */
  SESSION_EXPIRED: renderSpec(CATALOG.progress.sessionExpired()),

  /** Message shown when dashboard is closed */
  DASHBOARD_CLOSED: renderSpec(CATALOG.success.done('Dashboard closed.')),

  /** Message shown when entity is not found */
  NOT_FOUND: (entityType: string): string => renderSpec(CATALOG.error.notFound(entityType)),

  /** Message shown when user lacks permission */
  NO_PERMISSION: (action: string): string => renderSpec(CATALOG.error.permissionDenied(action)),

  /** Message shown when edit permission is denied */
  CANNOT_EDIT: renderSpec(CATALOG.error.permissionDenied('edit this')),

  /** Message shown when delete permission is denied */
  CANNOT_DELETE: renderSpec(CATALOG.error.permissionDenied('delete this')),

  /** Generic failure message */
  OPERATION_FAILED: (action: string): string => renderSpec(CATALOG.error.operationFailed(action)),

  /** Message shown when unknown section is selected */
  UNKNOWN_SECTION: renderSpec(CATALOG.error.validation('Unknown section.')),

  /** Message shown when unknown form is submitted */
  UNKNOWN_FORM: renderSpec(CATALOG.error.validation('Unknown form submission.')),

  /** Message shown during loading/processing */
  LOADING: (action: string): string => renderSpec(CATALOG.progress.working(action)),

  /** Message shown on successful action */
  SUCCESS: (action: string): string => renderSpec(CATALOG.success.done(action)),

  /** Message for delete confirmation title */
  DELETE_CONFIRM_TITLE: (entityType: string): string => `🗑️ Delete ${entityType}?`,

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
  return renderSpec(CATALOG.progress.sessionExpired(command));
}

/**
 * Format a not found message for a specific entity
 */
export function formatNotFoundMessage(entityType: string, entityName?: string): string {
  return renderSpec(CATALOG.error.notFound(entityType, { name: entityName }));
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
  return renderSpec(CATALOG.success.banner(verb, entityName));
}
