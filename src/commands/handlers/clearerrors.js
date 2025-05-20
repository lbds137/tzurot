/**
 * Clearerrors Command Handler
 * Clears error states for personalities
 */
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const { runtimeProblematicPersonalities, errorBlackoutPeriods } = require('../../aiService');

/**
 * Command metadata
 */
const meta = {
  name: 'clearerrors',
  description: 'Clear error states for personalities',
  usage: 'clearerrors',
  aliases: [],
  permissions: ['ADMINISTRATOR']
};

/**
 * Execute the clearerrors command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args) {
  // Create direct send function
  const directSend = validator.createDirectSend(message);
  
  // Check if user has Administrator permission
  const isDM = message.channel.isDMBased();
  const isAdmin = isDM ? false : validator.isAdmin(message);
  
  // For safety, require Admin permissions in servers
  if (!isDM && !isAdmin) {
    return directSend('You need Administrator permission to use this command.');
  }
  
  // Clear all runtime problematic personalities
  const problemPersonalityCount = runtimeProblematicPersonalities.size;
  runtimeProblematicPersonalities.clear();
  
  // Clear all error blackout periods
  const blackoutCount = errorBlackoutPeriods.size;
  errorBlackoutPeriods.clear();
  
  // Return success message with counts
  return directSend(`✅ Error state has been cleared:
- Cleared ${problemPersonalityCount} problematic personality registrations
- Cleared ${blackoutCount} error blackout periods

Personalities should now respond normally if they were previously failing.`);
}

module.exports = {
  meta,
  execute
};