/**
 * Deduplication Middleware
 */
const logger = require('../../logger');

/**
 * Deduplication middleware for commands
 * Prevents duplicate command processing
 *
 * @param {Object} message - Discord message object
 * @param {string} command - Command being executed
 * @param {Array<string>} args - Command arguments
 * @param {Object} messageTracker - MessageTracker instance
 * @returns {Object} Result with status and error
 */
function deduplicationMiddleware(message, command, args, messageTracker) {
  // Check if message was already processed
  if (messageTracker.isProcessed(message.id)) {
    logger.info(
      `[Deduplication] Message ${message.id} already processed, skipping duplicate command`
    );
    return {
      shouldProcess: false,
      error: null,
    };
  }

  // Mark the message as processed
  messageTracker.markAsProcessed(message.id);
  logger.info(`[Deduplication] Message ${message.id} will be processed`);

  // Check if this is a duplicate command based on user, command, and args
  if (messageTracker.isRecentCommand(message.author.id, command, args)) {
    logger.info(
      `[Deduplication] Detected duplicate command execution: ${command} from ${message.author.tag}, ignoring`
    );
    return {
      shouldProcess: false,
      error: null,
    };
  }

  // Special case for add command
  if (command === 'add' || command === 'create') {
    if (messageTracker.isAddCommandProcessed(message.id)) {
      logger.warn(
        `[Deduplication] This message (${message.id}) has already been processed by add command handler`
      );
      return {
        shouldProcess: false,
        error: null,
      };
    }

    // NOTE: We removed the markAddCommandAsProcessed call from here
    // The add command handler itself will mark the message as processed
    // This prevents the false positive where the middleware marks it as processed
    // before the command actually runs
  }

  // Command should be processed
  return {
    shouldProcess: true,
  };
}

module.exports = deduplicationMiddleware;
