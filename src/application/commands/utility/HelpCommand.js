/**
 * Help Command - Display help information for all commands
 *
 * Shows available commands grouped by category with detailed information
 * for specific commands when requested. Automatically filters admin-only
 * commands based on user permissions.
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Creates the executor function for the help command
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} Executor function
 */
function createExecutor(dependencies = {}) {
  return async function execute(context) {
    try {
      const {
        commandRegistry = require('../CommandAbstraction').getCommandRegistry(),
        botPrefix = require('../../../../config').botPrefix,
        botConfig = require('../../../../config').botConfig,
      } = dependencies;

      // Get the command name from args or options
      const commandName = context.options.command || context.args[0];

      if (commandName) {
        // Show help for specific command
        return await showCommandHelp(context, commandName, commandRegistry, botPrefix);
      } else {
        // Show general help
        return await showGeneralHelp(context, commandRegistry, botPrefix, botConfig);
      }
    } catch (error) {
      logger.error('[HelpCommand] Execution failed:', error);
      await context.respond('An error occurred while displaying help information.');
    }
  };
}

/**
 * Show help for a specific command
 */
async function showCommandHelp(context, commandName, commandRegistry, botPrefix) {
  const command = commandRegistry.get(commandName.toLowerCase());

  if (!command) {
    await context.respond(
      `Unknown command: \`${commandName}\`. Use \`${botPrefix}help\` to see available commands.`
    );
    return;
  }

  // Check if user has permission to see this command
  if (command.permissions.includes('ADMIN') && !context.isAdmin) {
    await context.respond('This command is only available to administrators.');
    return;
  }

  // Build detailed help for the command
  let helpContent = `**${botPrefix}${command.name}`;

  // Add command parameters to usage
  if (command.options && command.options.length > 0) {
    for (const option of command.options) {
      if (option.required) {
        helpContent += ` <${option.name}>`;
      } else {
        helpContent += ` [${option.name}]`;
      }
    }
  }

  helpContent += `**\n${command.description}`;

  // Add aliases if any
  if (command.aliases && command.aliases.length > 0) {
    helpContent += `\n\n**Aliases:** ${command.aliases.map(a => `\`${a}\``).join(', ')}`;
  }

  // Add options details if any
  if (command.options && command.options.length > 0) {
    helpContent += '\n\n**Options:**';
    for (const option of command.options) {
      helpContent += `\n• \`${option.name}\` - ${option.description}`;
      if (option.required) {
        helpContent += ' (required)';
      }
      if (option.choices && option.choices.length > 0) {
        helpContent += `\n  Choices: ${option.choices.map(c => `\`${c.value}\``).join(', ')}`;
      }
    }
  }

  // Add command-specific detailed help
  helpContent += getCommandSpecificHelp(command.name, botPrefix);

  await context.respond(helpContent);
}

/**
 * Get command-specific detailed help text
 */
function getCommandSpecificHelp(commandName, botPrefix) {
  switch (commandName) {
    case 'auth':
      return `\n\n**Subcommands:**
• \`start\` - Begin the authentication process and get an authorization URL
• \`code <code>\` - Submit your authorization code (DM only for security)
• \`status\` - Check your current authentication status
• \`revoke\` - Remove your authorization
• \`cleanup\` - Clean up expired authentication tokens (admin only)

**Security Note:** For your protection, authorization codes must be submitted via DM only. Messages with authorization codes in public channels will be deleted.`;

    case 'debug':
      return `\n\n**Subcommands:**
• \`clearwebhooks\` - Clear cached webhook identifications
• \`unverify\` - Clear your NSFW verification status
• \`clearconversation\` - Clear your conversation history
• \`clearauth\` - Clear your authentication tokens
• \`clearmessages\` - Clear message tracking history
• \`stats\` - Show debug statistics`;

    case 'add':
      return `\n\n**Example:** \`${botPrefix}add lilith-tzel-shani lilith\`

This will add the personality "lilith-tzel-shani" with an optional alias "lilith" that you can use as a shortcut.`;

    case 'list':
      return `\n\n**Examples:**
• \`${botPrefix}list\` - Show first page of personalities
• \`${botPrefix}list 2\` - Show second page of personalities`;

    case 'notifications':
      return `\n\n**Notification Levels:**
• \`major\` - Only notify for major releases (breaking changes)
• \`minor\` - Notify for minor and major releases (default)
• \`patch\` - Notify for all releases including bug fixes`;

    case 'autorespond':
      return `\n\n**Usage:**
• \`${botPrefix}autorespond on\` - Enable auto-response
• \`${botPrefix}autorespond off\` - Disable auto-response
• \`${botPrefix}autorespond status\` - Check current setting`;

    case 'purgbot':
      return `\n\n**Categories:**
• \`system\` - System messages and bot responses only (default)
• \`all\` - All bot messages including personality responses

**Note:** This command only works in DM channels for security reasons.`;

    default:
      return '';
  }
}

/**
 * Show general help with all commands
 */
async function showGeneralHelp(context, commandRegistry, botPrefix, botConfig) {
  // Get all commands
  const allCommands = commandRegistry.getAll();

  // Filter commands based on user permissions
  const availableCommands = allCommands.filter(cmd => {
    if (cmd.permissions.includes('ADMIN') && !context.isAdmin) {
      return false;
    }
    if (cmd.permissions.includes('OWNER') && context.userId !== process.env.BOT_OWNER_ID) {
      return false;
    }
    return true;
  });

  // Group commands by category
  const categories = {
    'Personality Management': [],
    Conversation: [],
    Authentication: [],
    Utility: [],
    Admin: [],
  };

  // Sort commands into categories
  availableCommands.forEach(cmd => {
    const category = getCategoryForCommand(cmd);
    if (categories[category]) {
      categories[category].push(cmd);
    }
  });

  // Create response based on platform capabilities
  if (context.respondWithEmbed) {
    // Discord-style embed
    const embed = {
      title: `${botConfig.name} Commands`,
      description: `Use \`${botPrefix}help <command>\` for more information about a specific command.`,
      color: 0x2196f3,
      fields: [],
    };

    // Add each category to the embed
    Object.entries(categories).forEach(([category, commands]) => {
      if (commands.length > 0) {
        // Sort commands alphabetically
        commands.sort((a, b) => a.name.localeCompare(b.name));

        // Format command list
        const commandList = commands
          .map(cmd => {
            const aliases =
              cmd.aliases && cmd.aliases.length > 0 ? ` (${cmd.aliases.join(', ')})` : '';
            return `\`${cmd.name}\`${aliases}: ${cmd.description}`;
          })
          .join('\n');

        embed.fields.push({
          name: category,
          value: commandList,
          inline: false,
        });
      }
    });

    await context.respondWithEmbed(embed);
  } else {
    // Text-based response
    let helpText = `**${botConfig.name} Commands**\n`;
    helpText += `Use \`${botPrefix}help <command>\` for more information about a specific command.\n`;

    Object.entries(categories).forEach(([category, commands]) => {
      if (commands.length > 0) {
        helpText += `\n**${category}**\n`;

        // Sort commands alphabetically
        commands.sort((a, b) => a.name.localeCompare(b.name));

        commands.forEach(cmd => {
          const aliases =
            cmd.aliases && cmd.aliases.length > 0 ? ` (${cmd.aliases.join(', ')})` : '';
          helpText += `• \`${cmd.name}\`${aliases}: ${cmd.description}\n`;
        });
      }
    });

    await context.respond(helpText);
  }
}

/**
 * Determine the category for a command
 */
function getCategoryForCommand(cmd) {
  // Admin commands
  if (cmd.permissions.includes('ADMIN') || cmd.permissions.includes('OWNER')) {
    return 'Admin';
  }

  // Check by command name
  const commandName = cmd.name.toLowerCase();

  // Personality management
  if (['add', 'remove', 'list', 'alias', 'info'].includes(commandName)) {
    return 'Personality Management';
  }

  // Conversation
  if (['activate', 'deactivate', 'reset', 'autorespond'].includes(commandName)) {
    return 'Conversation';
  }

  // Authentication
  if (['auth', 'verify'].includes(commandName)) {
    return 'Authentication';
  }

  // Default to Utility
  return 'Utility';
}

/**
 * Factory function to create the help command
 * @param {Object} dependencies - Optional dependencies to inject
 * @returns {Command} The help command instance
 */
function createHelpCommand(dependencies = {}) {
  return new Command({
    name: 'help',
    description: 'Display help information for commands',
    category: 'Utility',
    aliases: ['h', '?'],
    permissions: ['USER'],
    options: [
      new CommandOption({
        name: 'command',
        description: 'The command to get help for',
        type: 'string',
        required: false,
      }),
    ],
    execute: createExecutor(dependencies),
  });
}

module.exports = {
  createHelpCommand,
  // Export for testing
  getCategoryForCommand,
  getCommandSpecificHelp,
};
