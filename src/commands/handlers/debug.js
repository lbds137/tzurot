/**
 * Debug Command Handler
 * Advanced debugging tools for administrators
 */
const { EmbedBuilder } = require('discord.js');
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const {
  knownProblematicPersonalities,
  runtimeProblematicPersonalities,
} = require('../../aiService');
const { botPrefix } = require('../../../config');

/**
 * Command metadata
 */
const meta = {
  name: 'debug',
  description: 'Advanced debugging tools (Requires Administrator permission)',
  usage: 'debug <subcommand>',
  aliases: [],
  permissions: ['ADMINISTRATOR'],
};

/**
 * Execute the debug command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args) {
  // Create direct send function
  const directSend = validator.createDirectSend(message);

  // Check if the user provided a subcommand
  if (args.length < 1) {
    return await directSend(
      `You need to provide a subcommand. Usage: \`${botPrefix} debug <subcommand>\`\n\n` +
        `Available subcommands:\n` +
        `- \`problems\` - Display information about problematic personalities`
    );
  }

  const subCommand = args[0].toLowerCase();

  switch (subCommand) {
    case 'problems': {
      // Show information about problematic personalities
      const knownProblems = knownProblematicPersonalities.length;
      const runtimeProblems = runtimeProblematicPersonalities.size;

      // Prepare lists for the embed
      const shouldTruncate = knownProblematicPersonalities.length > 50;
      const knownList =
        knownProblematicPersonalities.length > 0
          ? shouldTruncate
            ? knownProblematicPersonalities.slice(0, 50).join('\n') + '...'
            : knownProblematicPersonalities.join('\n')
          : 'None';

      const runtimeList =
        runtimeProblematicPersonalities.size > 0
          ? Array.from(runtimeProblematicPersonalities.entries())
              .map(([name, timestamp]) => {
                const time = new Date(timestamp).toLocaleString();
                return `${name} (since ${time})`;
              })
              .join('\n')
          : 'None';

      // Create the embed
      const embed = new EmbedBuilder()
        .setTitle('Problematic Personalities Report')
        .setDescription(`Information about personalities that have experienced issues.`)
        .setColor(0xff9800)
        .addFields(
          {
            name: `Known Problematic (${knownProblems})`,
            value: knownList.length > 1024 ? `${knownList.substring(0, 1021)}...` : knownList,
            inline: false,
          },
          {
            name: `Runtime Problematic (${runtimeProblems})`,
            value: runtimeList.length > 1024 ? `${runtimeList.substring(0, 1021)}...` : runtimeList,
            inline: false,
          }
        )
        .setFooter({
          text: `Use "${botPrefix} clearerrors" to reset runtime problematic personalities.`,
        });

      return await directSend({ embeds: [embed] });
    }

    default:
      return await directSend(
        `Unknown debug subcommand: \`${subCommand}\`. Use \`${botPrefix} debug\` to see available subcommands.`
      );
  }
}

module.exports = {
  meta,
  execute,
};
