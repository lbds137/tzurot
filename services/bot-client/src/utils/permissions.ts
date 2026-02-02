/**
 * Permission Checking Utilities
 *
 * Provides utilities for checking Discord permissions in slash commands.
 * Used by commands that require specific server permissions.
 *
 * Bot owner (BOT_OWNER_ID) always has permission as an override, allowing
 * control over channels in servers where they may not have admin rights.
 */

import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { isBotOwner } from '@tzurot/common-types';
import type { DeferredCommandContext } from './commandContext/types.js';

/** Error message for commands that require a guild context */
const ERROR_GUILD_ONLY = '❌ This command can only be used in a server.';

/** Error message for commands that require ManageMessages permission */
const ERROR_MANAGE_MESSAGES_REQUIRED =
  '❌ You need the "Manage Messages" permission to use this command.';

/**
 * Require ManageMessages permission for a command.
 *
 * Checks that:
 * 1. Command is being run in a guild (not DMs)
 * 2. Member has ManageMessages permission OR is the bot owner
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
      content: ERROR_GUILD_ONLY,
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  // Bot owner always has permission (override for abuse control)
  if (isBotOwner(interaction.user.id)) {
    return true;
  }

  // Get member and check permissions
  const member = interaction.member as GuildMember;

  // Check for ManageMessages permission
  if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      content: ERROR_MANAGE_MESSAGES_REQUIRED,
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
      content: ERROR_GUILD_ONLY,
    });
    return false;
  }

  // Bot owner always has permission (override for abuse control)
  if (isBotOwner(interaction.user.id)) {
    return true;
  }

  // Get member and check permissions
  const member = interaction.member as GuildMember;

  // Check for ManageMessages permission
  if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.editReply({
      content: ERROR_MANAGE_MESSAGES_REQUIRED,
    });
    return false;
  }

  return true;
}

/**
 * Require ManageMessages permission for a context-aware command.
 *
 * Context-aware version of requireManageMessagesDeferred for use with
 * SafeCommandContext pattern.
 *
 * @param context - The deferred command context to check
 * @returns true if user has permission, false if not (error already sent)
 */
export async function requireManageMessagesContext(
  context: DeferredCommandContext
): Promise<boolean> {
  // Check if in guild
  if (context.guildId === null) {
    await context.editReply({
      content: ERROR_GUILD_ONLY,
    });
    return false;
  }

  // Bot owner always has permission (override for abuse control)
  if (isBotOwner(context.user.id)) {
    return true;
  }

  // Get member and check permissions
  const member = context.member;

  if (member === null) {
    await context.editReply({
      content: '❌ Unable to verify your permissions.',
    });
    return false;
  }

  // Check for ManageMessages permission
  if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await context.editReply({
      content: ERROR_MANAGE_MESSAGES_REQUIRED,
    });
    return false;
  }

  return true;
}
