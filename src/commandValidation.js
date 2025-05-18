/**
 * Command Validation Middleware
 * Provides validation for command parameters to ensure commands receive correct arguments
 */
const logger = require('./logger');

/**
 * Validation schema for commands
 * Each command has a set of rules for its parameters
 */
const validationRules = {
  add: {
    required: ['profileName'],
    optional: ['alias'],
    types: {
      profileName: 'string',
      alias: 'string',
    },
    errorMessages: {
      profileName: 'Profile name is required and must be a string',
      alias: 'Alias must be a string if provided',
    },
  },
  alias: {
    required: ['profileName', 'newAlias'],
    types: {
      profileName: 'string',
      newAlias: 'string',
    },
    errorMessages: {
      profileName: 'Profile name is required and must be a string',
      newAlias: 'New alias is required and must be a string',
    },
  },
  remove: {
    required: ['profileName'],
    types: {
      profileName: 'string',
    },
    errorMessages: {
      profileName: 'Profile name is required and must be a string',
    },
  },
  info: {
    required: ['profileName'],
    types: {
      profileName: 'string',
    },
    errorMessages: {
      profileName: 'Profile name is required and must be a string',
    },
  },
  activate: {
    required: ['personalityName'],
    types: {
      personalityName: 'string',
    },
    errorMessages: {
      personalityName: 'Personality name is required and must be a string',
    },
  },
  autorespond: {
    required: ['status'],
    types: {
      status: 'string',
    },
    validation: {
      status: value => ['on', 'off', 'status'].includes(value.toLowerCase()),
    },
    errorMessages: {
      status: 'Status must be one of: on, off, status',
    },
  },
};

/**
 * Validates a parameter's type
 * @param {*} value - The parameter value
 * @param {string} expectedType - The expected type
 * @returns {boolean} - Whether the parameter is of the expected type
 */
const validateType = (value, expectedType) => {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' || (typeof value === 'string' && !isNaN(Number(value)));
    case 'boolean':
      return (
        typeof value === 'boolean' ||
        (typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase()))
      );
    case 'array':
      return Array.isArray(value);
    default:
      return true;
  }
};

/**
 * Validates command parameters against defined rules
 * @param {string} commandName - The name of the command
 * @param {Object} args - Command arguments
 * @returns {Object} - Validation result { isValid, errors }
 */
const validateCommand = (commandName, args) => {
  const rules = validationRules[commandName];

  if (!rules) {
    logger.debug(`[CommandValidation] No validation rules found for command: ${commandName}`);
    return { isValid: true, errors: [] }; // No validation rules for this command
  }

  const errors = [];

  // Check required parameters
  if (rules.required) {
    for (const param of rules.required) {
      if (args[param] === undefined || args[param] === null || args[param] === '') {
        const errorMessage = rules.errorMessages[param] || `${param} is required`;
        logger.debug(`[CommandValidation] Required parameter missing: ${param}`);
        errors.push(errorMessage);
      }
    }
  }

  // Check parameter types
  if (rules.types) {
    for (const [param, expectedType] of Object.entries(rules.types)) {
      if (
        args[param] !== undefined &&
        args[param] !== null &&
        !validateType(args[param], expectedType)
      ) {
        const errorMessage = rules.errorMessages[param] || `${param} must be a ${expectedType}`;
        logger.debug(
          `[CommandValidation] Parameter type mismatch: ${param} should be ${expectedType}`
        );
        errors.push(errorMessage);
      }
    }
  }

  // Run custom validation functions
  if (rules.validation) {
    for (const [param, validationFn] of Object.entries(rules.validation)) {
      if (args[param] !== undefined && args[param] !== null && !validationFn(args[param])) {
        const errorMessage = rules.errorMessages[param] || `${param} is invalid`;
        logger.debug(`[CommandValidation] Custom validation failed for parameter: ${param}`);
        errors.push(errorMessage);
      }
    }
  }

  const isValid = errors.length === 0;
  if (!isValid) {
    logger.debug(
      `[CommandValidation] Validation failed for command ${commandName}: ${errors.join(', ')}`
    );
  } else {
    logger.debug(`[CommandValidation] Command ${commandName} passed validation`);
  }

  return {
    isValid,
    errors,
  };
};

/**
 * Validation middleware for commands
 * @param {string} commandName - The name of the command
 * @param {Object} args - Command arguments
 * @returns {Object} - { success, message, validatedArgs }
 */
const validateCommandMiddleware = (commandName, args) => {
  try {
    const { isValid, errors } = validateCommand(commandName, args);

    if (!isValid) {
      return {
        success: false,
        message: `Validation failed: ${errors.join(', ')}`,
        errors,
      };
    }

    // For successful validation, return processed args (could include type conversions)
    const processedArgs = { ...args };

    return {
      success: true,
      message: 'Validation successful',
      validatedArgs: processedArgs,
    };
  } catch (error) {
    logger.error(`[CommandValidation] Error in validation middleware: ${error.message}`, error);
    return {
      success: false,
      message: `Validation error: ${error.message}`,
      errors: [error.message],
    };
  }
};

module.exports = {
  validateCommand,
  validateCommandMiddleware,
  validationRules,
};
