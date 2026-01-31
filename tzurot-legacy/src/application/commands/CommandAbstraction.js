/**
 * Platform-agnostic command abstraction layer
 * Supports both Discord slash commands and text-based commands
 * @module application/commands/CommandAbstraction
 */

const logger = require('../../logger');
const { botPrefix } = require('../../../config');

/**
 * Represents a platform-agnostic command
 */
class Command {
  constructor({
    name,
    description,
    category = 'general',
    aliases = [],
    permissions = ['USER'],
    options = [],
    execute,
  }) {
    this.name = name;
    this.description = description;
    this.category = category;
    this.aliases = aliases;
    this.permissions = permissions;
    this.options = options;
    this.execute = execute;

    // Validate required fields
    if (!name || typeof name !== 'string') {
      throw new Error('Command name is required and must be a string');
    }
    if (!description || typeof description !== 'string') {
      throw new Error('Command description is required and must be a string');
    }
    if (typeof execute !== 'function') {
      throw new Error('Command execute function is required');
    }
  }

  /**
   * Convert to Discord slash command format
   */
  toDiscordSlashCommand() {
    return {
      name: this.name,
      description: this.description,
      options: this.options.map(opt => this._convertOptionToDiscord(opt)),
    };
  }

  /**
   * Convert to text command format (for legacy Discord and Revolt)
   */
  toTextCommand() {
    return {
      name: this.name,
      description: this.description,
      usage: this._generateUsage(),
      aliases: this.aliases,
      permissions: this.permissions,
      execute: this.execute,
    };
  }

  /**
   * Generate usage string from options
   */
  _generateUsage() {
    const parts = [`${botPrefix} ${this.name}`];

    for (const option of this.options) {
      if (option.required) {
        parts.push(`<${option.name}>`);
      } else {
        parts.push(`[${option.name}]`);
      }
    }

    return parts.join(' ');
  }

  /**
   * Convert option to Discord format
   */
  _convertOptionToDiscord(option) {
    const discordOption = {
      name: option.name,
      description: option.description,
      type: this._getDiscordOptionType(option.type),
      required: option.required || false,
    };

    if (option.choices && option.choices.length > 0) {
      discordOption.choices = option.choices.map(choice => ({
        name: choice.label || choice.value,
        value: choice.value,
      }));
    }

    return discordOption;
  }

  /**
   * Map option types to Discord types
   */
  _getDiscordOptionType(type) {
    const typeMap = {
      string: 3, // STRING
      integer: 4, // INTEGER
      boolean: 5, // BOOLEAN
      user: 6, // USER
      channel: 7, // CHANNEL
      role: 8, // ROLE
      number: 10, // NUMBER
    };

    return typeMap[type] || 3; // Default to STRING
  }
}

/**
 * Represents a command option
 */
class CommandOption {
  constructor({ name, description, type = 'string', required = false, choices = [] }) {
    this.name = name;
    this.description = description;
    this.type = type;
    this.required = required;
    this.choices = choices;
  }
}

/**
 * Platform-agnostic command context
 */
class CommandContext {
  constructor({
    platform, // 'discord' or 'revolt'
    isSlashCommand = false,
    message, // Original message object
    interaction, // Discord interaction (for slash commands)
    author, // User who invoked the command
    channel, // Channel where command was invoked
    guild, // Guild/Server (if applicable)
    args = [], // Parsed arguments
    options = {}, // Named options (for slash commands)
    reply, // Reply function
    dependencies = {}, // Injected dependencies
    // Additional properties for better context
    userId, // User ID
    channelId, // Channel ID
    guildId, // Guild ID
    isDirectMessage, // Whether this is a DM (undefined means auto-detect)
    commandPrefix, // Command prefix used
    originalMessage, // Original message object (same as message, for compatibility)
    isAdmin = false, // Whether user has admin permissions
  }) {
    this.platform = platform;
    this.isSlashCommand = isSlashCommand;
    this.message = message;
    this.interaction = interaction;
    this.author = author;
    this.channel = channel;
    this.guild = guild;
    this.args = args;
    this.options = options;
    this.reply = reply;
    this.dependencies = dependencies;
    // Store additional properties
    this.userId = userId || author?.id;
    this.channelId = channelId || channel?.id;
    this.guildId = guildId || guild?.id;
    this.isDirectMessage = isDirectMessage;
    this.commandPrefix = commandPrefix;
    this.originalMessage = originalMessage || message;

    // Admin check property
    this.isAdmin = isAdmin;
  }

  /**
   * Get argument value by position or name
   */
  getArgument(nameOrIndex) {
    if (this.isSlashCommand) {
      return this.options[nameOrIndex];
    } else {
      if (typeof nameOrIndex === 'number') {
        return this.args[nameOrIndex];
      }
      // For text commands, we can't get by name unless we parse
      return null;
    }
  }

  /**
   * Reply to the command
   */
  async respond(content, options = {}) {
    if (this.reply) {
      return await this.reply(content, options);
    }

    // Fallback for different platforms
    if (this.platform === 'discord' && this.isSlashCommand && this.interaction) {
      if (this.interaction.deferred) {
        return await this.interaction.editReply(content);
      } else {
        return await this.interaction.reply(content);
      }
    } else if (this.message && this.message.reply) {
      return await this.message.reply(content);
    } else if (this.channel && this.channel.send) {
      return await this.channel.send(content);
    }

    throw new Error('No valid reply method available');
  }

  /**
   * Get user ID in platform-agnostic way
   */
  getUserId() {
    return this.userId || this.author?.id || this.author?.userId || null;
  }

  /**
   * Get channel ID in platform-agnostic way
   */
  getChannelId() {
    return this.channelId || this.channel?.id || this.channel?.channelId || null;
  }

  /**
   * Get guild ID in platform-agnostic way
   */
  getGuildId() {
    return this.guildId || this.guild?.id || this.guild?.guildId || null;
  }

  /**
   * Get message ID in platform-agnostic way
   */
  getMessageId() {
    return this.message?.id || this.interaction?.id || null;
  }

  /**
   * Check if command was used in DM
   */
  isDM() {
    // If isDirectMessage was explicitly set, use that
    if (this.isDirectMessage !== undefined) {
      return this.isDirectMessage;
    }
    // Otherwise, determine based on platform
    if (this.platform === 'discord') {
      return !this.guild && !this.guildId;
    } else if (this.platform === 'revolt') {
      return this.channel?.channel_type === 'DirectMessage';
    }
    return false;
  }

  /**
   * Check if embeds are supported in the current context
   */
  canEmbed() {
    if (this.platform === 'discord') {
      // Discord supports embeds in both guild channels and DMs
      return true;
    } else if (this.platform === 'revolt') {
      // Revolt has limited embed support
      return false;
    }
    return false;
  }

  /**
   * Delete the original message (if supported by platform)
   */
  async deleteMessage() {
    if (this.platform === 'discord' && this.message && this.message.delete) {
      try {
        return await this.message.delete();
      } catch (error) {
        logger.error(`[CommandContext] Failed to delete message: ${error.message}`);
        throw error;
      }
    }
    throw new Error('Delete message not supported on this platform');
  }

  /**
   * Send a direct message to the user
   */
  async sendDM(content, options = {}) {
    if (this.platform === 'discord' && this.author) {
      try {
        return await this.author.send(content, options);
      } catch (error) {
        logger.error(`[CommandContext] Failed to send DM: ${error.message}`);
        throw error;
      }
    }
    throw new Error('Send DM not supported on this platform');
  }

  /**
   * Send an embed response
   */
  async respondWithEmbed(embed) {
    if (!this.canEmbed()) {
      // Fallback to text representation
      return this.respond(this._embedToText(embed));
    }

    if (this.platform === 'discord') {
      // For Discord, wrap the embed properly
      const options = { embeds: [embed] };

      if (this.isSlashCommand && this.interaction) {
        if (this.interaction.deferred || this.interaction.replied) {
          return await this.interaction.editReply(options);
        } else {
          return await this.interaction.reply(options);
        }
      } else if (this.message) {
        return await this.message.reply(options);
      } else if (this.channel) {
        return await this.channel.send(options);
      }
    }

    // Fallback for unsupported platforms
    return this.respond(this._embedToText(embed));
  }

  /**
   * Get author display name
   */
  getAuthorDisplayName() {
    return this.author?.username || this.author?.tag || this.author?.name || 'Unknown User';
  }

  /**
   * Get author avatar URL
   */
  getAuthorAvatarUrl() {
    if (this.platform === 'discord' && this.author) {
      return this.author.displayAvatarURL?.() || this.author.avatarURL?.() || null;
    }
    return this.author?.avatarUrl || this.author?.avatar || null;
  }

  /**
   * Check if user has a specific permission in the current context
   * @param {string} permission - The permission to check
   * @returns {Promise<boolean>} Whether the user has the permission
   */
  async hasPermission(permission) {
    if (this.platform === 'discord') {
      // For DMs, no permissions apply
      if (!this.guild) {
        return false;
      }

      // Check if we have member permissions
      if (this.message && this.message.member) {
        const { PermissionFlagsBits } = require('discord.js');
        // Map permission names to Discord permission flags
        const permissionMap = {
          ManageMessages: PermissionFlagsBits.ManageMessages,
          Administrator: PermissionFlagsBits.Administrator,
          ManageGuild: PermissionFlagsBits.ManageGuild,
          ManageChannels: PermissionFlagsBits.ManageChannels,
        };

        const permissionFlag = permissionMap[permission];
        if (permissionFlag) {
          return this.message.member.permissions.has(permissionFlag);
        }
      }
    }
    // For other platforms or unknown permissions, default to false for safety
    return false;
  }

  /**
   * Check if the current channel is marked as NSFW
   * @returns {Promise<boolean>} Whether the channel is NSFW
   */
  async isChannelNSFW() {
    if (this.platform === 'discord' && this.channel) {
      // Direct check for the channel's nsfw flag
      if (this.channel.nsfw === true) {
        return true;
      }

      // If this is a thread, check its parent channel
      // Discord.js v14 uses channel.type to check for threads
      const { ChannelType } = require('discord.js');
      const isThread =
        this.channel.type === ChannelType.PublicThread ||
        this.channel.type === ChannelType.PrivateThread ||
        this.channel.type === ChannelType.AnnouncementThread;

      if (isThread) {
        // Try different ways to access the parent channel
        const parent = this.channel.parent || this.channel.parentChannel;
        if (parent && parent.nsfw === true) {
          return true;
        }

        // If parent is not directly available, try using parentId
        if (this.channel.parentId && this.guild) {
          const parentFromCache = this.guild.channels.cache.get(this.channel.parentId);
          if (parentFromCache && parentFromCache.nsfw === true) {
            return true;
          }
        }
      }

      // For forum posts, also check parent
      if (this.channel.parentId && this.guild) {
        const parent = this.guild.channels.cache.get(this.channel.parentId);
        if (parent && parent.nsfw === true) {
          return true;
        }
      }
    }
    // For other platforms or if we can't determine, default to false
    return false;
  }

  /**
   * Convert embed to text representation
   * @private
   */
  _embedToText(embed) {
    let text = '';

    if (embed.title) {
      text += `**${embed.title}**\n`;
    }

    if (embed.description) {
      text += `${embed.description}\n`;
    }

    if (embed.fields) {
      for (const field of embed.fields) {
        text += `\n**${field.name}**\n${field.value}\n`;
      }
    }

    if (embed.footer?.text) {
      text += `\n_${embed.footer.text}_`;
    }

    return text.trim();
  }
}

/**
 * Command registry that manages commands for all platforms
 */
class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.aliases = new Map();
  }

  /**
   * Register a command
   */
  register(command) {
    if (!(command instanceof Command)) {
      throw new Error('Must register a Command instance');
    }

    // Register main command
    this.commands.set(command.name, command);

    // Register aliases
    for (const alias of command.aliases) {
      this.aliases.set(alias, command.name);
    }

    logger.info(`[CommandRegistry] Registered command: ${command.name}`);
  }

  /**
   * Get command by name or alias
   */
  get(nameOrAlias) {
    // Direct lookup
    if (this.commands.has(nameOrAlias)) {
      return this.commands.get(nameOrAlias);
    }

    // Alias lookup
    const commandName = this.aliases.get(nameOrAlias);
    if (commandName) {
      return this.commands.get(commandName);
    }

    return null;
  }

  /**
   * Get all commands
   */
  getAll() {
    return Array.from(this.commands.values());
  }

  /**
   * Get commands by category
   */
  getByCategory(category) {
    return this.getAll().filter(cmd => cmd.category === category);
  }

  /**
   * Export as Discord slash commands
   */
  toDiscordSlashCommands() {
    return this.getAll().map(cmd => cmd.toDiscordSlashCommand());
  }

  /**
   * Export as text commands
   */
  toTextCommands() {
    const textCommands = {};
    for (const cmd of this.getAll()) {
      textCommands[cmd.name] = cmd.toTextCommand();
    }
    return textCommands;
  }

  /**
   * Clear all commands
   */
  clear() {
    this.commands.clear();
    this.aliases.clear();
  }
}

// Create singleton instance
let registryInstance = null;

/**
 * Get the command registry singleton
 */
function getCommandRegistry() {
  if (!registryInstance) {
    registryInstance = new CommandRegistry();
  }
  return registryInstance;
}

/**
 * Reset the registry (for testing)
 */
function resetRegistry() {
  registryInstance = null;
}

module.exports = {
  Command,
  CommandOption,
  CommandContext,
  CommandRegistry,
  getCommandRegistry,
  resetRegistry,
};
