/**
 * Dashboard Close Handler
 *
 * Shared handler for closing dashboards. Cleans up session
 * and shows standard closed message.
 */

import type { ButtonInteraction } from 'discord.js';
import { getSessionManager } from './SessionManager.js';
import { DASHBOARD_MESSAGES } from './messages.js';

/**
 * Handle dashboard close button click.
 * Deletes the session and shows closed confirmation.
 *
 * @param interaction - Button interaction
 * @param entityType - Entity type (e.g., 'persona', 'character', 'preset')
 * @param entityId - Entity identifier
 * @param customMessage - Optional custom close message
 *
 * @example
 * ```typescript
 * await handleDashboardClose(interaction, 'persona', personaId);
 * ```
 */
export async function handleDashboardClose(
  interaction: ButtonInteraction,
  entityType: string,
  entityId: string,
  customMessage?: string
): Promise<void> {
  const sessionManager = getSessionManager();
  await sessionManager.delete(interaction.user.id, entityType, entityId);

  await interaction.update({
    content: customMessage ?? DASHBOARD_MESSAGES.DASHBOARD_CLOSED,
    embeds: [],
    components: [],
  });
}

/**
 * Create a close handler for a specific entity type.
 * Useful for extracting handler to a config object.
 *
 * @param entityType - Entity type (e.g., 'persona', 'character', 'preset')
 * @returns Handler function for close button
 *
 * @example
 * ```typescript
 * const handleClose = createCloseHandler('preset');
 * // Later:
 * await handleClose(interaction, presetId);
 * ```
 */
export function createCloseHandler(
  entityType: string
): (interaction: ButtonInteraction, entityId: string) => Promise<void> {
  return async (interaction: ButtonInteraction, entityId: string): Promise<void> => {
    await handleDashboardClose(interaction, entityType, entityId);
  };
}
