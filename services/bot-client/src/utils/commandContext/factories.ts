/**
 * Command Context Factories
 *
 * Factory functions to create typed command contexts from Discord.js interactions.
 * Each factory returns a context with only the methods appropriate for that
 * deferral mode, enabling compile-time prevention of invalid method calls.
 */

import type {
  ChatInputCommandInteraction,
  GuildMember,
  Guild,
  TextBasedChannel,
  User,
} from 'discord.js';
import type { DeferredCommandContext, ModalCommandContext, ManualCommandContext } from './types.js';

/**
 * Base context properties returned by createBaseContext.
 * Shared by all context types (DeferredCommandContext, ModalCommandContext, etc.)
 */
interface BaseContextProperties {
  readonly interaction: ChatInputCommandInteraction;
  readonly user: User;
  readonly guild: Guild | null;
  readonly member: GuildMember | null;
  readonly channel: TextBasedChannel | null;
  readonly channelId: string;
  readonly guildId: string | null;
  readonly commandName: string;
  getOption: <T>(name: string) => T | null;
  getRequiredOption: <T>(name: string) => T;
  getSubcommand: () => string | null;
  getSubcommandGroup: () => string | null;
}

/**
 * Create base context properties shared by all context types.
 * These are read-only accessors that don't modify interaction state.
 */
function createBaseContext(interaction: ChatInputCommandInteraction): BaseContextProperties {
  return {
    interaction,
    user: interaction.user,
    guild: interaction.guild,
    member: interaction.member as GuildMember | null,
    channel: interaction.channel,
    channelId: interaction.channelId,
    guildId: interaction.guildId,
    commandName: interaction.commandName,
    getOption: <T>(name: string): T | null => {
      const option = interaction.options.get(name);
      return (option?.value ?? null) as T | null;
    },
    getRequiredOption: <T>(name: string): T => {
      const option = interaction.options.get(name, true);
      return option.value as T;
    },
    getSubcommand: (): string | null => {
      try {
        return interaction.options.getSubcommand(false);
      } catch {
        return null;
      }
    },
    getSubcommandGroup: (): string | null => {
      try {
        return interaction.options.getSubcommandGroup(false);
      } catch {
        return null;
      }
    },
  };
}

/**
 * Create context for deferred commands (ephemeral or public).
 *
 * The returned context intentionally does NOT have deferReply() -
 * the framework has already called it before the command executes.
 *
 * @param interaction - The Discord.js interaction (already deferred)
 * @param isEphemeral - Whether the deferral was ephemeral
 * @returns A DeferredCommandContext with only post-deferral methods
 */
export function createDeferredContext(
  interaction: ChatInputCommandInteraction,
  isEphemeral: boolean
): DeferredCommandContext {
  const base = createBaseContext(interaction);

  return {
    ...base,
    isEphemeral,
    editReply: options => interaction.editReply(options),
    followUp: options => interaction.followUp(options),
    deleteReply: () => interaction.deleteReply(),
  };
}

/**
 * Create context for modal commands.
 *
 * The framework does NOT defer these interactions - the command
 * must show a modal within 3 seconds.
 *
 * @param interaction - The Discord.js interaction (NOT deferred)
 * @returns A ModalCommandContext with modal-appropriate methods
 */
export function createModalContext(interaction: ChatInputCommandInteraction): ModalCommandContext {
  const base = createBaseContext(interaction);

  return {
    ...base,
    showModal: modal => interaction.showModal(modal),
    reply: options => interaction.reply(options),
    deferReply: options => interaction.deferReply(options),
  };
}

/**
 * Create context for commands with no automatic deferral.
 *
 * The command is responsible for responding within 3 seconds.
 * Use sparingly - prefer specific deferral modes when possible.
 *
 * @param interaction - The Discord.js interaction (NOT deferred)
 * @returns A ManualCommandContext with all response methods
 */
export function createManualContext(
  interaction: ChatInputCommandInteraction
): ManualCommandContext {
  const base = createBaseContext(interaction);

  return {
    ...base,
    reply: options => interaction.reply(options),
    deferReply: options => interaction.deferReply(options),
    editReply: options => interaction.editReply(options),
    showModal: modal => interaction.showModal(modal),
  };
}
