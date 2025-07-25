/**
 * Command adapter that bridges platform-agnostic commands with Discord
 * @module application/commands/CommandAdapter
 */

const logger = require('../../logger');
const { CommandContext } = require('./CommandAbstraction');
const { botPrefix } = require('../../../config');

/**
 * Adapts platform-agnostic commands to work with Discord.js
 */
class DiscordCommandAdapter {
  constructor({ commandRegistry, applicationServices = {} }) {
    this.commandRegistry = commandRegistry;
    this.applicationServices = applicationServices;
  }

  /**
   * Handle a text-based command from Discord
   */
  async handleTextCommand(message, commandName, args) {
    try {
      const command = this.commandRegistry.get(commandName);
      if (!command) {
        return null;
      }

      // Check for duplicate message processing using messageTracker
      const messageTracker = this.applicationServices.messageTracker;
      if (messageTracker && !messageTracker.track(message.id, 'ddd-command')) {
        logger.warn(
          `[DiscordCommandAdapter] Prevented duplicate command processing for message ${message.id}`
        );
        return { success: true, duplicate: true }; // Command was "handled" (prevented duplicate)
      }

      // Create platform-agnostic context
      const context = new CommandContext({
        platform: 'discord',
        isSlashCommand: false,
        message: message,
        author: message.author,
        channel: message.channel,
        guild: message.guild,
        args: args,
        reply: (content, _options) => message.reply(content),
        dependencies: this.applicationServices,
        // Add these missing properties for better context
        userId: message.author.id,
        channelId: message.channel.id,
        guildId: message.guild?.id || null,
        isDirectMessage: !message.guild,
        commandPrefix: botPrefix,
        originalMessage: message,
        // Add admin check for text commands
        isAdmin:
          message.guild && message.member
            ? message.member.permissions.has(
                require('discord.js').PermissionFlagsBits.Administrator
              )
            : false,
      });

      // Execute the command
      return await command.execute(context);
    } catch (error) {
      logger.error(`[DiscordCommandAdapter] Error handling text command ${commandName}:`, error);
      throw error;
    }
  }

  /**
   * Handle a slash command interaction from Discord
   */
  async handleSlashCommand(interaction) {
    try {
      const commandName = interaction.commandName;
      const command = this.commandRegistry.get(commandName);

      if (!command) {
        return await interaction.reply({
          content: 'Unknown command',
          ephemeral: true,
        });
      }

      // Extract options into a flat object
      const options = {};
      for (const option of interaction.options.data) {
        options[option.name] = option.value;
      }

      // Create platform-agnostic context
      const context = new CommandContext({
        platform: 'discord',
        isSlashCommand: true,
        interaction: interaction,
        author: interaction.user,
        channel: interaction.channel,
        guild: interaction.guild,
        options: options,
        reply: async (content, opts = {}) => {
          if (interaction.deferred || interaction.replied) {
            return await interaction.editReply(content);
          } else {
            return await interaction.reply({ content, ...opts });
          }
        },
        dependencies: this.applicationServices,
        // Add missing properties for slash commands
        userId: interaction.user.id,
        channelId: interaction.channel?.id,
        guildId: interaction.guild?.id || null,
        isDirectMessage: !interaction.guild,
        commandPrefix: '/',
        // Add admin check for slash commands
        isAdmin:
          interaction.guild && interaction.member
            ? interaction.member.permissions.has(
                require('discord.js').PermissionFlagsBits.Administrator
              )
            : false,
      });

      // Execute the command
      return await command.execute(context);
    } catch (error) {
      logger.error(
        `[DiscordCommandAdapter] Error handling slash command ${interaction.commandName}:`,
        error
      );

      const errorMessage = 'An error occurred while executing the command';
      if (interaction.deferred || interaction.replied) {
        return await interaction.editReply(errorMessage);
      } else {
        return await interaction.reply({
          content: errorMessage,
          ephemeral: true,
        });
      }
    }
  }

  /**
   * Register slash commands with Discord
   */
  async registerSlashCommands(client, guildId = null) {
    try {
      const slashCommands = this.commandRegistry.toDiscordSlashCommands();

      if (guildId) {
        // Register to specific guild (faster for development)
        const guild = await client.guilds.fetch(guildId);
        await guild.commands.set(slashCommands);
        logger.info(
          `[DiscordCommandAdapter] Registered ${slashCommands.length} slash commands to guild ${guildId}`
        );
      } else {
        // Register globally (takes up to 1 hour to propagate)
        await client.application.commands.set(slashCommands);
        logger.info(
          `[DiscordCommandAdapter] Registered ${slashCommands.length} slash commands globally`
        );
      }

      return slashCommands;
    } catch (error) {
      logger.error('[DiscordCommandAdapter] Error registering slash commands:', error);
      throw error;
    }
  }

  /**
   * Create help embed for all commands
   */
  createHelpEmbed() {
    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder().setTitle('Available Commands').setColor(0x00ae86);

    // Group commands by category
    const categories = new Map();
    for (const command of this.commandRegistry.getAll()) {
      if (!categories.has(command.category)) {
        categories.set(command.category, []);
      }
      categories.get(command.category).push(command);
    }

    // Add fields for each category
    for (const [category, commands] of categories) {
      const commandList = commands.map(cmd => `**${cmd.name}** - ${cmd.description}`).join('\n');

      embed.addFields({
        name: category.charAt(0).toUpperCase() + category.slice(1),
        value: commandList || 'No commands',
        inline: false,
      });
    }

    embed.setFooter({
      text: `Use ${botPrefix} <command> for text commands or /<command> for slash commands`,
    });

    return embed;
  }
}

/**
 * Adapts platform-agnostic commands to work with Revolt
 */
class RevoltCommandAdapter {
  constructor({ commandRegistry, applicationServices = {} }) {
    this.commandRegistry = commandRegistry;
    this.applicationServices = applicationServices;
  }

  /**
   * Handle a text-based command from Revolt
   */
  async handleTextCommand(message, commandName, args) {
    try {
      const command = this.commandRegistry.get(commandName);
      if (!command) {
        return null;
      }

      // Create platform-agnostic context
      const context = new CommandContext({
        platform: 'revolt',
        isSlashCommand: false,
        message: message,
        author: message.author,
        channel: message.channel,
        guild: message.server, // Revolt uses 'server' instead of 'guild'
        args: args,
        reply: content => message.reply(content),
        dependencies: this.applicationServices,
      });

      // Execute the command
      return await command.execute(context);
    } catch (error) {
      logger.error(`[RevoltCommandAdapter] Error handling text command ${commandName}:`, error);
      throw error;
    }
  }

  /**
   * Create help message for all commands
   */
  createHelpMessage() {
    const lines = ['**Available Commands**\n'];

    // Group commands by category
    const categories = new Map();
    for (const command of this.commandRegistry.getAll()) {
      if (!categories.has(command.category)) {
        categories.set(command.category, []);
      }
      categories.get(command.category).push(command);
    }

    // Add each category
    for (const [category, commands] of categories) {
      lines.push(`\n**${category.charAt(0).toUpperCase() + category.slice(1)}**`);
      for (const cmd of commands) {
        const textCmd = cmd.toTextCommand();
        lines.push(`• \`${textCmd.usage}\` - ${cmd.description}`);
      }
    }

    return lines.join('\n');
  }
}

/**
 * Factory to create appropriate adapter based on platform
 */
class CommandAdapterFactory {
  static create(platform, options) {
    switch (platform.toLowerCase()) {
      case 'discord':
        return new DiscordCommandAdapter(options);
      case 'revolt':
        return new RevoltCommandAdapter(options);
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
}

module.exports = {
  DiscordCommandAdapter,
  RevoltCommandAdapter,
  CommandAdapterFactory,
};
