/**
 * List Command Handler
 * Lists all personalities added by the user
 */
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const { listPersonalitiesForUser } = require('../../personalityManager');
const embedHelpers = require('../../embedHelpers');
const { botPrefix } = require('../../../config');

/**
 * Command metadata
 */
const meta = {
  name: 'list',
  description: 'List all AI personalities you\'ve added',
  usage: 'list [page]',
  aliases: [],
  permissions: []
};

/**
 * Execute the list command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args) {
  // Create direct send function
  const directSend = validator.createDirectSend(message);

  try {
    // Get the user's personalities
    const personalities = listPersonalitiesForUser(message.author.id);

    if (!personalities || personalities.length === 0) {
      return await directSend(
        `You haven't added any personalities yet. Use \`${botPrefix} add <personality-name>\` to add one.`
      );
    }

    // Get the page number from args, default to 1
    const page = args.length > 0 && !isNaN(args[0]) ? parseInt(args[0], 10) : 1;
    const pageSize = 10; // Number of personalities per page
    const totalPages = Math.ceil(personalities.length / pageSize);

    // Validate page number
    if (page < 1 || page > totalPages) {
      return await directSend(
        `Invalid page number. Please specify a page between 1 and ${totalPages}.`
      );
    }

    // Calculate slice indices
    const startIdx = (page - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, personalities.length);
    const pagePersonalities = personalities.slice(startIdx, endIdx);

    // Build the embed
    const embed = embedHelpers.createListEmbed(pagePersonalities, page, totalPages, message.author);
    
    return await directSend({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in list command:', error);
    return await directSend(`An error occurred while listing personalities: ${error.message}`);
  }
}

module.exports = {
  meta,
  execute
};