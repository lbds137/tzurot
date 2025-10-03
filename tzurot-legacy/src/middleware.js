/**
 * Middleware System for Command Processing
 * Provides a way to apply multiple middleware functions to commands in a pipeline.
 */
// Load logger first to avoid circular dependencies
const logger = require('./logger');

// Import validation separately to avoid circular dependencies
let validationRules = {};
let validateCommandMiddleware = null;

// Lazy-load the validation rules to prevent circular dependencies
function getValidationRules() {
  if (Object.keys(validationRules).length === 0) {
    try {
      // Only load validation rules when needed
      const commandValidation = require('./commandValidation');
      validationRules = commandValidation.validationRules;
      validateCommandMiddleware = commandValidation.validateCommandMiddleware;
    } catch (error) {
      logger.error('Error loading command validation:', error);
    }
  }
  return validationRules;
}

/**
 * Middleware Manager class
 * Handles the registration and execution of middleware functions
 */
class MiddlewareManager {
  constructor() {
    this.middlewares = [];
    this.name = 'MiddlewareManager';

    // Initialize with validation middleware
    this.use(this.validationMiddleware.bind(this));
  }

  /**
   * Add a middleware function to the pipeline
   * @param {Function} middleware - Middleware function to be executed
   * @returns {MiddlewareManager} - Returns this for chaining
   */
  use(middleware) {
    if (typeof middleware !== 'function') {
      throw new Error('Middleware must be a function');
    }
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Execute the middleware pipeline for a command
   * @param {Object} context - The context object containing command info and args
   * @returns {Promise<Object>} - The final context after all middleware has executed
   */
  async execute(context) {
    logger.debug(
      `[${this.name}] Starting middleware pipeline with ${this.middlewares.length} middleware functions`
    );

    // Make a copy of the original context to avoid mutation issues
    let currentContext = { ...context };

    // Process each middleware in sequence
    for (const middleware of this.middlewares) {
      try {
        // Each middleware can modify the context or return early
        const result = await middleware(currentContext);

        // If middleware returned false or a result with earlyReturn: true, stop processing
        if (result === false || (result && result.earlyReturn === true)) {
          logger.debug(`[${this.name}] Middleware pipeline stopped early`);

          // If we have a result object with earlyReturn, use it as the new context
          if (result && result.earlyReturn === true) {
            currentContext = result;
          } else {
            // Otherwise, add an explicit early return flag
            currentContext.earlyReturn = true;
          }

          break;
        }

        // Update context with middleware result if one was returned
        if (result) {
          currentContext = { ...currentContext, ...result };
        }
      } catch (error) {
        logger.error(`[${this.name}] Error in middleware execution:`, error);
        return {
          earlyReturn: true,
          error: true,
          message: `Middleware error: ${error.message}`,
        };
      }
    }

    logger.debug(
      `[${this.name}] Middleware pipeline completed for command: ${currentContext.command}`
    );
    return currentContext;
  }

  /**
   * Validation middleware that uses the existing command validation system
   * @param {Object} context - The context object containing command info and args
   * @returns {Object} - Updated context with validation result
   */
  validationMiddleware(context) {
    // Skip validation if command doesn't need it
    if (!context.requiresValidation) {
      return context;
    }

    const { command, args } = context;
    logger.debug(`[${this.name}] Validating command: ${command}`);

    // Lazy-load the validation rules and middleware if not already loaded
    if (!validateCommandMiddleware) {
      try {
        const commandValidation = require('./commandValidation');
        validateCommandMiddleware = commandValidation.validateCommandMiddleware;
      } catch (error) {
        logger.error('Error loading command validation middleware:', error);
        return {
          earlyReturn: true,
          error: true,
          message: `Validation system not available: ${error.message}`,
        };
      }
    }

    // Convert args array to named parameters according to the command's expected format
    const namedArgs = this.convertArgsToNamedParams(command, args);

    // Run the validation middleware
    const validationResult = validateCommandMiddleware(command, namedArgs);

    if (!validationResult.success) {
      // If validation failed, return early with errors
      logger.debug(`[${this.name}] Validation failed for command: ${command}`);
      return {
        earlyReturn: true,
        error: true,
        validationErrors: validationResult.errors,
        message: validationResult.message,
      };
    }

    // Update the context with validated args
    return {
      ...context,
      namedArgs: validationResult.validatedArgs,
      validated: true,
    };
  }

  /**
   * Convert array arguments to named parameters based on command validation rules
   * @param {string} command - Command name
   * @param {Array} args - Array of command arguments
   * @returns {Object} - Named parameters object
   */
  convertArgsToNamedParams(command, args) {
    // Get validation rules, loading them if necessary
    const rules = getValidationRules()[command];

    // If no rules exist for this command, return args as is
    if (!rules) {
      return { _raw: args };
    }

    const namedArgs = {};

    // Map the positional arguments to named parameters based on required and optional arrays
    const paramNames = [...(rules.required || []), ...(rules.optional || [])];

    paramNames.forEach((paramName, index) => {
      if (index < args.length) {
        namedArgs[paramName] = args[index];
      }
    });

    // Store the raw args as well
    namedArgs._raw = args;

    return namedArgs;
  }
}

// Create a singleton instance of the middleware manager
const middlewareManager = new MiddlewareManager();

/**
 * Creates a middleware function that logs command execution
 * @returns {Function} - Logging middleware function
 */
const createLoggingMiddleware = () => {
  return async context => {
    const { command, args, message } = context;
    logger.info(
      `Executing command: ${command} with args: ${JSON.stringify(args)} from user: ${message.author.tag}`
    );
    return context;
  };
};

/**
 * Creates a middleware function for permission checking
 * @param {Function} permissionCheckFn - Function to check permissions
 * @returns {Function} - Permission middleware function
 */
const createPermissionMiddleware = permissionCheckFn => {
  return async context => {
    const { command, message } = context;

    const hasPermission = await permissionCheckFn(message, command);
    if (!hasPermission) {
      return {
        earlyReturn: true,
        error: true,
        message: 'You do not have permission to execute this command.',
      };
    }

    return context;
  };
};

/**
 * Creates a rate limiting middleware
 * @param {number} limit - Maximum number of requests in timeWindow
 * @param {number} timeWindow - Time window in milliseconds
 * @returns {Function} - Rate limiting middleware function
 */
const createRateLimitMiddleware = (limit = 5, timeWindow = 10000) => {
  const requests = new Map();

  return async context => {
    const { message, command } = context;
    const key = `${message.author.id}:${command}`;

    const now = Date.now();
    const userRequests = requests.get(key) || [];

    // Filter out old requests outside the time window
    const recentRequests = userRequests.filter(timestamp => now - timestamp < timeWindow);

    // Check if user has exceeded the limit
    if (recentRequests.length >= limit) {
      return {
        earlyReturn: true,
        error: true,
        message: `Rate limit exceeded for command: ${command}. Please try again later.`,
      };
    }

    // Add the current request timestamp
    recentRequests.push(now);
    requests.set(key, recentRequests);

    return context;
  };
};

module.exports = {
  middlewareManager,
  createLoggingMiddleware,
  createPermissionMiddleware,
  createRateLimitMiddleware,
};
