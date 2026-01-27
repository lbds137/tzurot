/**
 * Dashboard Permission Checks
 *
 * Shared utilities for checking and handling permissions in dashboard interactions.
 */

import { MessageFlags } from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { DASHBOARD_MESSAGES } from './messages.js';

/**
 * Entity with permission information
 */
interface PermissionEntity {
  canEdit?: boolean;
  ownerId?: string;
}

/**
 * Check if user has edit permission and reply with error if not.
 * Returns true if user has permission, false if blocked.
 *
 * @param interaction - Button or select menu interaction
 * @param entity - Entity with canEdit field
 * @param action - Action being attempted (for error message)
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
  action = 'edit this'
): Promise<boolean> {
  if (entity.canEdit === true) {
    return true;
  }

  await interaction.reply({
    content: DASHBOARD_MESSAGES.NO_PERMISSION(action),
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

/**
 * Check if user owns an entity (by ownerId comparison).
 * Does NOT send a reply - use when you need custom handling.
 */
export function isOwner(userId: string, entity: PermissionEntity): boolean {
  return entity.ownerId === userId;
}

/**
 * Check ownership and reply with error if not owner.
 * Returns true if user is owner, false if blocked.
 *
 * @param interaction - Button or select menu interaction
 * @param entity - Entity with ownerId field
 * @param action - Action being attempted (for error message)
 * @returns true if owner, false if blocked
 */
export async function checkOwnership(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  entity: PermissionEntity,
  action = 'modify this'
): Promise<boolean> {
  if (entity.ownerId === interaction.user.id) {
    return true;
  }

  await interaction.reply({
    content: DASHBOARD_MESSAGES.NO_PERMISSION(action),
    flags: MessageFlags.Ephemeral,
  });
  return false;
}
