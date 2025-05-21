/**
 * Help Command Handler
 */
const { EmbedBuilder } = require('discord.js');
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const { botPrefix } = require('../../../config');
const embedHelpers = require('../../utils/embedBuilders');

/**
 * Command metadata
 */
const meta = {
  name: 'help',
  description: 'Display help information for commands',
  usage: 'help [command]',
  aliases: [],
  permissions: []
};

/**
 * Execute the help command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args) {
  logger.info(`Processing help command with args: ${args.join(', ')}`);

  try {
    // Create direct send function
    const directSend = validator.createDirectSend(message);

    // Directly get the command registry
    const commandRegistry = require('../utils/commandRegistry');

    if (args.length > 0) {
      // Help for a specific command
      const commandName = args[0].toLowerCase();
      
      // Look up the command in the registry
      const command = commandRegistry.get(commandName);
      
      if (!command) {
        return await directSend(
          `Unknown command: \`${commandName}\`. Use \`${botPrefix} help\` to see available commands.`
        );
      }
      
      // Check if the user has the required permissions
      if (command.meta.permissions && command.meta.permissions.includes('ADMINISTRATOR') && !validator.isAdmin(message)) {
        return await directSend(`This command is only available to administrators.`);
      }
      
      // Generate help content
      let helpContent = `**${botPrefix} ${command.meta.usage}**\n${command.meta.description}`;
      
      // Special case for commands with additional help content
      switch (commandName) {
        case 'auth':
          helpContent += `\n\nSubcommands:\n` +
            `- \`start\` - Begin the authentication process and get an authorization URL\n` +
            `- \`code <code>\` - Submit your authorization code (DM only for security)\n` +
            `- \`status\` - Check your current authentication status\n` +
            `- \`revoke\` - Remove your authorization\n\n` +
            `Security Note: For your protection, authorization codes must be submitted via DM only. ` +
            `Messages with authorization codes in public channels will be deleted.`;
          break;
          
        case 'debug':
          helpContent += `\n\nAvailable subcommands:\n` +
            `- \`problems\` - Display information about problematic personalities\n\n` +
            `Example: \`${botPrefix} debug problems\``;
          break;
          
        case 'add':
        case 'create':
          helpContent += `\n\n` +
            `- \`profile_name\` is the name of the personality (required)\n` +
            `- \`alias\` is an optional nickname you can use to reference this personality (optional)\n\n` +
            `Example: \`${botPrefix} add lilith-tzel-shani lilith\``;
          break;
          
        case 'list':
          helpContent += `\n\n` +
            `- \`page\` is an optional page number for pagination (default: 1)\n\n` +
            `Examples:\n` +
            `\`${botPrefix} list\` - Show first page of personalities\n` +
            `\`${botPrefix} list 2\` - Show second page of personalities`;
          break;
      }
      
      // If command has aliases, show them
      if (command.meta.aliases && command.meta.aliases.length > 0) {
        helpContent += `\n\nAliases: ${command.meta.aliases.map(a => `\`${a}\``).join(', ')}`;
      }
      
      return await directSend(helpContent);
    }

    // General help
    const isAdmin = validator.isAdmin(message);
    logger.debug(`[HelpCommand] User is admin: ${isAdmin}`);
    
    // Get all commands from the registry
    const commands = commandRegistry.getAllCommands();
    logger.debug(`[HelpCommand] Retrieved ${commands.size} commands from registry`);
    const allCommands = Array.from(commands.values());
    
    // Filter commands based on user permissions
    const availableCommands = allCommands.filter(cmd => {
      // If command requires admin and user is not admin, filter it out
      if (cmd.meta.permissions && cmd.meta.permissions.includes('ADMINISTRATOR') && !isAdmin) {
        return false;
      }
      return true;
    });
    
    // Group commands by category
    const categories = {
      'Personality Management': [],
      'Conversation': [],
      'Authentication': [],
      'System': [],
      'Admin': []
    };
    
    // Sort commands into categories
    availableCommands.forEach(cmd => {
      if (cmd.meta.permissions && cmd.meta.permissions.includes('ADMINISTRATOR')) {
        categories['Admin'].push(cmd);
      } else if (['add', 'remove', 'list', 'alias', 'info'].includes(cmd.meta.name)) {
        categories['Personality Management'].push(cmd);
      } else if (['activate', 'deactivate', 'reset', 'autorespond'].includes(cmd.meta.name)) {
        categories['Conversation'].push(cmd);
      } else if (['auth', 'verify'].includes(cmd.meta.name)) {
        categories['Authentication'].push(cmd);
      } else {
        categories['System'].push(cmd);
      }
    });
    
    // Create embed with categories
    const embed = new EmbedBuilder()
      .setTitle('Tzurot Commands')
      .setDescription(`Use \`${botPrefix} help <command>\` for more information about a specific command.`)
      .setColor(0x2196f3);
    
    // Add each category to the embed
    Object.entries(categories).forEach(([category, commands]) => {
      if (commands.length > 0) {
        // Sort commands alphabetically
        commands.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
        
        // Format command list
        const commandList = commands.map(cmd => {
          // Include aliases if any
          const aliases = cmd.meta.aliases && cmd.meta.aliases.length > 0
            ? ` (${cmd.meta.aliases.join(', ')})`
            : '';
          
          return `\`${cmd.meta.name}\`${aliases}: ${cmd.meta.description}`;
        }).join('\n');
        
        embed.addFields({ name: category, value: commandList });
      }
    });
    
    return await directSend({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in help command:', error);
    // Try to send via direct send, but fall back to channel if that fails
    try {
      logger.debug(`[HelpCommand] Attempting to send error message via direct send`);
      // Get a fresh directSend function
      const directSendFunc = validator.createDirectSend(message);
      return await directSendFunc(`An error occurred while processing the help command: ${error.message}`);
    } catch (directSendError) {
      logger.error(`[HelpCommand] Failed to send via direct send, falling back to channel:`, directSendError);
      return message.channel.send(
        `An error occurred while processing the help command: ${error.message}`
      );
    }
  }
}

module.exports = {
  meta,
  execute
};