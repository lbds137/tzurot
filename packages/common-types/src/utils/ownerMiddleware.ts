/**
 * Owner Middleware
 *
 * Centralized bot owner verification for owner-only commands.
 * Used by admin and personality management commands.
 */

import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { MessageFlags } from 'discord-api-types/v10';
import { getConfig } from '../config/index.js';

/**
 * Branded boolean marking "the current user is the bot owner / admin". Only
 * {@link isBotOwner} and the explicit {@link asIsAdmin} escape hatch produce it,
 * so a parameter typed `IsAdmin` (e.g. a dashboard's admin-section gate) CANNOT
 * be handed a plain boolean like `canEdit` by accident — that is a compile error.
 * Guards the isAdmin-vs-canEdit confusion class that leaked the bot-owner-only
 * Admin Settings section to non-admin owners.
 *
 * The brand is a compile-time phantom (erased at runtime, survives JSON
 * round-trips as a plain boolean), so it costs nothing and needs no migration.
 */
export type IsAdmin = boolean & { readonly __brand: 'IsAdmin' };

/**
 * Assert a plain boolean IS an admin flag, producing the branded {@link IsAdmin}.
 * The ONLY sanctioned construction outside {@link isBotOwner} — for tests and the
 * rare case where a bot-owner status was already computed/cached as a plain
 * boolean. Do NOT wrap `canEdit` (true for any character owner, not just admins):
 * that is exactly the confusion this brand exists to prevent.
 */
export function asIsAdmin(value: boolean): IsAdmin {
  return value as IsAdmin;
}

/**
 * Check if a Discord ID matches the configured bot owner
 *
 * Used for:
 * - Auto-promoting bot owner to superuser on first interaction
 * - BYOK wallet owner checks
 *
 * @param discordId - Discord user ID to check
 * @returns true if the ID matches BOT_OWNER_ID config
 *
 * Returns a plain `boolean` (not the branded {@link IsAdmin}) so the ~40 test
 * files that mock this function keep working with plain `mockReturnValue(true)`.
 * Callers that feed a dashboard's admin gate wrap the result in {@link asIsAdmin}
 * at the call site — that one explicit wrap is what the brand-guard keys on.
 */
export function isBotOwner(discordId: string): boolean {
  const config = getConfig();
  return config.BOT_OWNER_ID !== undefined && config.BOT_OWNER_ID === discordId;
}

/**
 * Verify that the interaction user is the bot owner
 *
 * Replies with error message if verification fails.
 *
 * @param interaction - Discord command or modal interaction
 * @returns true if user is owner, false otherwise
 */
export async function requireBotOwner(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction
): Promise<boolean> {
  const config = getConfig();
  const ownerId = config.BOT_OWNER_ID;

  // Check if owner ID is configured
  if (ownerId === undefined || ownerId === null || ownerId.length === 0) {
    await interaction.reply({
      content: '⚠️ Bot owner not configured. Please set BOT_OWNER_ID environment variable.',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  // Check if user is the owner
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: '❌ Owner-only command. This command is restricted to the bot owner.',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  return true;
}
