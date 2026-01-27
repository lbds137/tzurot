/**
 * Dashboard Permission Checks
 *
 * Shared utilities for checking and handling permissions in dashboard interactions.
 */

import { MessageFlags } from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { DASHBOARD_MESSAGES } from './messages.js';

/**
 * Entity with permission information.
 * Supports two ownership patterns:
 * - `ownerId` - Compare against user ID (typical API response)
 * - `isOwned` - Pre-computed boolean (flattened dashboard data)
 */
interface PermissionEntity {
  canEdit?: boolean;
  ownerId?: string;
  isOwned?: boolean;
}

/**
 * Options for permission check functions
 */
interface PermissionCheckOptions {
  /** Use followUp instead of reply (for deferred interactions) */
  deferred?: boolean;
}

/**
 * Check if user has edit permission and reply with error if not.
 * Returns true if user has permission, false if blocked.
 *
 * @param interaction - Button or select menu interaction
 * @param entity - Entity with canEdit field
 * @param action - Action being attempted (for error message)
 * @param options - Options including deferred flag
 * @returns true if permitted, false if blocked
 *
 * @example
 * ```typescript
 * if (!await checkEditPermission(interaction, preset, 'edit this preset')) {
 *   return;
 * }
 * // User has permission, proceed with edit
 * ```
 */
export async function checkEditPermission(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  entity: PermissionEntity,
  action = 'edit this',
  options: PermissionCheckOptions = {}
): Promise<boolean> {
  if (entity.canEdit === true) {
    return true;
  }

  const content = DASHBOARD_MESSAGES.NO_PERMISSION(action);

  if (options.deferred === true) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
  return false;
}

/**
 * Check if user owns an entity.
 * Supports both `ownerId` comparison and `isOwned` boolean.
 * Does NOT send a reply - use when you need custom handling.
 */
export function isOwner(userId: string, entity: PermissionEntity): boolean {
  return entity.isOwned === true || entity.ownerId === userId;
}

/**
 * Check ownership and reply with error if not owner.
 * Returns true if user is owner, false if blocked.
 *
 * Supports two patterns:
 * - `entity.ownerId` compared against user ID
 * - `entity.isOwned` pre-computed boolean
 *
 * @param interaction - Button or select menu interaction
 * @param entity - Entity with ownerId or isOwned field
 * @param action - Action being attempted (for error message)
 * @param options - Options including deferred flag
 * @returns true if owner, false if blocked
 */
export async function checkOwnership(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  entity: PermissionEntity,
  action = 'modify this',
  options: PermissionCheckOptions = {}
): Promise<boolean> {
  // Support both ownership patterns
  if (entity.isOwned === true || entity.ownerId === interaction.user.id) {
    return true;
  }

  const content = DASHBOARD_MESSAGES.NO_PERMISSION(action);

  if (options.deferred === true) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
  return false;
}
