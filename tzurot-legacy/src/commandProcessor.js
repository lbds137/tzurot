/**
 * Command Processor - Integrates middleware system with command processing
 *
 * This file serves as a bridge between command handling and middleware,
 * providing a structured pipeline for command processing with validation,
 * permissions, rate limiting, and other middleware capabilities.
 */

// Import logger first to avoid circular dependencies
const logger = require('./logger');
const {
  middlewareManager,
  createLoggingMiddleware,
  createPermissionMiddleware,
  createRateLimitMiddleware,
} = require('./middleware');
// Load config without creating circular dependencies
const { botPrefix } = require('../config');

// Set up default middleware chain
// These middleware functions will be applied to every command in order
try {
  middlewareManager.use(createLoggingMiddleware());
  middlewareManager.use(createRateLimitMiddleware(5, 10000)); // 5 requests per 10 seconds per command per user
} catch (error) {
  logger.error('[CommandProcessor] Error setting up middleware:', error);
}

/**
 * Process a command through the middleware pipeline
 * @param {Object} message - Discord message object
 * @param {string} command - Command name
 * @param {Array<string>} args - Command arguments
 * @param {Object} options - Additional processing options
 * @returns {Promise<Object>} - Processing result
 */
async function processCommand(message, command, args, options = {}) {
  try {
    logger.info(
      `[CommandProcessor] Processing command: ${command} with args: ${JSON.stringify(args)}`
    );

    // Create context object for middleware pipeline
    const context = {
      message,
      command,
      args,
      requiresValidation: true, // Most commands require validation
      userId: message.author.id,
      channelId: message.channel.id,
      guildId: message.guild?.id,
      timestamp: Date.now(),
      ...options, // Add any additional options passed in
    };

    // Execute the middleware pipeline
    const result = await middlewareManager.execute(context);

    // If middleware pipeline indicates early return (usually due to validation failure),
    // handle accordingly
    if (result.earlyReturn) {
      if (result.error) {
        // Handle error case
        logger.warn(
          `[CommandProcessor] Command processing stopped early with error: ${result.message}`
        );

        // If we have validation errors, format them for user display
        if (result.validationErrors) {
          const errorMessage = `Command validation failed: ${result.validationErrors.join(', ')}`;
          return {
            success: false,
            message: errorMessage,
            shouldReply: true,
            replyContent: errorMessage,
          };
        }

        // Generic error response
        return {
          success: false,
          message: result.message || 'An error occurred while processing the command.',
          shouldReply: true,
          replyContent: result.message || 'An error occurred while processing the command.',
        };
      }

      // Non-error early returns (like rate limiting, etc.)
      return {
        success: false,
        earlyReturn: true,
        message: result.message,
        shouldReply: !!result.message,
        replyContent: result.message,
      };
    }

    // Command processed successfully through middleware
    return {
      success: true,
      context: result, // Return the processed context
      command,
      args: result.namedArgs || args, // Use validated args if available
      validated: result.validated,
    };
  } catch (error) {
    logger.error(`[CommandProcessor] Unhandled error processing command ${command}:`, error);

    // Return error response
    return {
      success: false,
      message: `An unexpected error occurred: ${error.message}`,
      error,
      shouldReply: true,
      replyContent: `An unexpected error occurred. Please try again.`,
    };
  }
}

/**
 * Register a command handler function that will be executed after middleware processing
 * @param {string} commandName - The name of the command
 * @param {Object} options - Command options (permissions, rate limits, etc.)
 * @param {Function} handlerFn - The function to execute if middleware passes
 */
function registerCommandHandler(commandName, options, handlerFn) {
  if (!commandName || typeof commandName !== 'string') {
    throw new Error('Command name is required and must be a string');
  }

  if (typeof handlerFn !== 'function') {
    throw new Error('Command handler must be a function');
  }

  // Store this command handler for later use
  // Implementation will depend on how the command system is structured
  logger.info(`[CommandProcessor] Registered handler for command: ${commandName}`);

  // Apply command-specific middleware if specified in options
  if (options.permissions) {
    const permissionMiddleware = createPermissionMiddleware(options.permissions);
    middlewareManager.use(context => {
      // Only apply this middleware to this specific command
      if (context.command === commandName) {
        return permissionMiddleware(context);
      }
      return context;
    });
  }
}

/**
 * Create a direct send function to safely send messages
 * Helps avoid Discord.js reply bug
 * @param {Object} message - Discord message object
 * @returns {Function} A function to send messages directly
 */
function createDirectSend(message) {
  return async content => {
    try {
      if (typeof content === 'string') {
        return await message.channel.send(content);
      } else {
        return await message.channel.send(content);
      }
    } catch (err) {
      logger.error('[CommandProcessor] Error sending message:', err);
      return null;
    }
  };
}

/**
 * Handle unknown commands with a helpful response
 * @param {Object} message - Discord message object
 * @param {string} command - The unknown command
 * @returns {Promise<Object>} Response message
 */
async function handleUnknownCommand(message, command) {
  const response = `Unknown command: \`${command}\`. Use \`${botPrefix} help\` to see available commands.`;

  try {
    const sent = await message.channel.send(response);
    return {
      success: false,
      message: response,
      sent,
    };
  } catch (error) {
    logger.error('[CommandProcessor] Error sending unknown command response:', error);
    return {
      success: false,
      message: response,
      error,
    };
  }
}

/**
 * Create a formatted help message for a command
 * @param {string} command - Command name
 * @param {Object} options - Command options (description, usage, etc.)
 * @returns {string} Formatted help text
 */
function createHelpText(command, options = {}) {
  const { description, usage, examples } = options;

  let helpText = `**${botPrefix} ${command}**`;

  if (usage) {
    helpText += `\n${usage}`;
  }

  if (description) {
    helpText += `\n${description}`;
  }

  if (examples && examples.length > 0) {
    helpText += '\n\nExamples:';
    examples.forEach(example => {
      helpText += `\n\`${botPrefix} ${example}\``;
    });
  }

  return helpText;
}

module.exports = {
  processCommand,
  registerCommandHandler,
  createDirectSend,
  handleUnknownCommand,
  createHelpText,
  middlewareManager,
};
