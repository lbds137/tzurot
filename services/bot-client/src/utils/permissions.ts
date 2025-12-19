/**
 * Permission Checking Utilities
 *
 * Provides utilities for checking Discord permissions in slash commands.
 * Used by commands that require specific server permissions.
 */

import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { ChatInputCommandInteraction, GuildMember } from 'discord.js';

/**
 * Require ManageMessages permission for a command.
 *
 * Checks that:
 * 1. Command is being run in a guild (not DMs)
 * 2. Member has ManageMessages permission
 *
 * If checks fail, sends an appropriate error reply and returns false.
 * If checks pass, returns true and the command can proceed.
 *
 * @param interaction - The command interaction to check
 * @returns true if user has permission, false if not (error already sent)
 *
 * @example
 * ```typescript
 * export async function handleActivate(interaction: ChatInputCommandInteraction): Promise<void> {
 *   if (!await requireManageMessages(interaction)) return;
 *   // User has permission, proceed with command
 * }
 * ```
 */
export async function requireManageMessages(
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  // Check if in guild
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: '❌ This command can only be used in a server.',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  // Get member and check permissions
  const member = interaction.member as GuildMember;

  // Check for ManageMessages permission
  if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      content: '❌ You need the "Manage Messages" permission to use this command.',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  return true;
}

/**
 * Require ManageMessages permission for a deferred command.
 *
 * Same as requireManageMessages but uses editReply instead of reply,
 * for use after deferReply() has been called.
 *
 * @param interaction - The command interaction to check
 * @returns true if user has permission, false if not (error already sent)
 */
export async function requireManageMessagesDeferred(
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  // Check if in guild
  if (!interaction.inGuild()) {
    await interaction.editReply({
      content: '❌ This command can only be used in a server.',
    });
    return false;
  }

  // Get member and check permissions
  const member = interaction.member as GuildMember;

  // Check for ManageMessages permission
  if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.editReply({
      content: '❌ You need the "Manage Messages" permission to use this command.',
    });
    return false;
  }

  return true;
}
