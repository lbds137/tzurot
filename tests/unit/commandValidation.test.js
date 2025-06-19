/**
 * Tests for Command Validation
 *
 * Tests the command validation middleware including type checking,
 * required parameter validation, and custom validation rules.
 */

const {
  validateCommand,
  validateCommandMiddleware,
  validationRules,
} = require('../../src/commandValidation');
const logger = require('../../src/logger');

// Mock dependencies
jest.mock('../../src/logger');

describe('Command Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateCommand', () => {
    describe('add command validation', () => {
      it('should validate valid add command', () => {
        const result = validateCommand('add', {
          profileName: 'testProfile',
        });

        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
        expect(logger.debug).toHaveBeenCalledWith(
          '[CommandValidation] Command add passed validation'
        );
      });

      it('should validate add command with optional alias', () => {
        const result = validateCommand('add', {
          profileName: 'testProfile',
          alias: 'testAlias',
        });

        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should fail when profileName is missing', () => {
        const result = validateCommand('add', {});

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Profile name is required and must be a string');
        expect(logger.debug).toHaveBeenCalledWith(
          '[CommandValidation] Required parameter missing: profileName'
        );
      });

      it('should fail when profileName is null', () => {
        const result = validateCommand('add', {
          profileName: null,
        });

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Profile name is required and must be a string');
      });

      it('should fail when profileName is empty string', () => {
        const result = validateCommand('add', {
          profileName: '',
        });

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Profile name is required and must be a string');
      });

      it('should fail when alias is not a string', () => {
        const result = validateCommand('add', {
          profileName: 'test',
          alias: 123,
        });

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Alias must be a string if provided');
      });
    });

    describe('alias command validation', () => {
      it('should validate valid alias command', () => {
        const result = validateCommand('alias', {
          profileName: 'oldName',
          newAlias: 'newName',
        });

        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should fail when profileName is missing', () => {
        const result = validateCommand('alias', {
          newAlias: 'newName',
        });

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Profile name is required and must be a string');
      });

      it('should fail when newAlias is missing', () => {
        const result = validateCommand('alias', {
          profileName: 'oldName',
        });

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('New alias is required and must be a string');
      });

      it('should fail with multiple errors', () => {
        const result = validateCommand('alias', {});

        expect(result.isValid).toBe(false);
        expect(result.errors).toHaveLength(2);
        expect(result.errors).toContain('Profile name is required and must be a string');
        expect(result.errors).toContain('New alias is required and must be a string');
      });
    });

    describe('remove command validation', () => {
      it('should validate valid remove command', () => {
        const result = validateCommand('remove', {
          profileName: 'testProfile',
        });

        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should fail when profileName is missing', () => {
        const result = validateCommand('remove', {});

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Profile name is required and must be a string');
      });
    });

    describe('info command validation', () => {
      it('should validate valid info command', () => {
        const result = validateCommand('info', {
          profileName: 'testProfile',
        });

        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should fail when profileName is missing', () => {
        const result = validateCommand('info', {});

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Profile name is required and must be a string');
      });
    });

    describe('activate command validation', () => {
      it('should validate valid activate command', () => {
        const result = validateCommand('activate', {
          personalityName: 'testPersonality',
        });

        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should fail when personalityName is missing', () => {
        const result = validateCommand('activate', {});

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Personality name is required and must be a string');
      });
    });

    describe('autorespond command validation', () => {
      it('should validate valid autorespond command with on', () => {
        const result = validateCommand('autorespond', {
          status: 'on',
        });

        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should validate valid autorespond command with off', () => {
        const result = validateCommand('autorespond', {
          status: 'off',
        });

        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should validate valid autorespond command with status', () => {
        const result = validateCommand('autorespond', {
          status: 'status',
        });

        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should validate case-insensitive status values', () => {
        const result = validateCommand('autorespond', {
          status: 'ON',
        });

        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should fail with invalid status value', () => {
        const result = validateCommand('autorespond', {
          status: 'invalid',
        });

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Status must be one of: on, off, status');
        expect(logger.debug).toHaveBeenCalledWith(
          '[CommandValidation] Custom validation failed for parameter: status'
        );
      });

      it('should fail when status is missing', () => {
        const result = validateCommand('autorespond', {});

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Status must be one of: on, off, status');
      });
    });

    describe('unknown command validation', () => {
      it('should pass validation for unknown commands', () => {
        const result = validateCommand('unknownCommand', {
          anyParam: 'anyValue',
        });

        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
        expect(logger.debug).toHaveBeenCalledWith(
          '[CommandValidation] No validation rules found for command: unknownCommand'
        );
      });
    });

    describe('type validation', () => {
      it('should validate string types correctly', () => {
        const result = validateCommand('add', {
          profileName: 'test',
        });

        expect(result.isValid).toBe(true);
      });

      it('should fail for non-string when string expected', () => {
        const result = validateCommand('add', {
          profileName: 123,
        });

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Profile name is required and must be a string');
      });

      it('should not validate type for undefined optional parameters', () => {
        const result = validateCommand('add', {
          profileName: 'test',
          alias: undefined,
        });

        expect(result.isValid).toBe(true);
      });

      it('should not validate type for null optional parameters', () => {
        const result = validateCommand('add', {
          profileName: 'test',
          alias: null,
        });

        expect(result.isValid).toBe(true);
      });
    });

    describe('validation failure logging', () => {
      it('should log validation failures with all errors', () => {
        validateCommand('alias', {});

        expect(logger.debug).toHaveBeenCalledWith(
          expect.stringContaining('[CommandValidation] Validation failed for command alias:')
        );
        expect(logger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Profile name is required and must be a string')
        );
        expect(logger.debug).toHaveBeenCalledWith(
          expect.stringContaining('New alias is required and must be a string')
        );
      });
    });
  });

  describe('validateCommandMiddleware', () => {
    it('should return success for valid command', () => {
      const result = validateCommandMiddleware('add', {
        profileName: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Validation successful');
      expect(result.validatedArgs).toEqual({ profileName: 'test' });
    });

    it('should return failure for invalid command', () => {
      const result = validateCommandMiddleware('add', {});

      expect(result.success).toBe(false);
      expect(result.message).toContain('Validation failed:');
      expect(result.errors).toContain('Profile name is required and must be a string');
    });

    it('should handle validation errors gracefully', () => {
      // To test the error handling, we need to create a scenario that would cause
      // an error in the validateCommand function. Since validateCommand is robust,
      // we'll test that validateCommandMiddleware properly wraps any potential errors.

      // We'll modify the validationRules to include a rule that throws an error
      const originalRules = validationRules.testError;
      validationRules.testError = {
        validation: {
          testParam: () => {
            throw new Error('Test error');
          },
        },
        errorMessages: {},
      };

      const result = validateCommandMiddleware('testError', { testParam: 'value' });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Validation error: Test error');
      expect(result.errors).toEqual(['Test error']);
      expect(logger.error).toHaveBeenCalledWith(
        '[CommandValidation] Error in validation middleware: Test error',
        expect.any(Error)
      );

      // Cleanup
      if (originalRules) {
        validationRules.testError = originalRules;
      } else {
        delete validationRules.testError;
      }
    });

    it('should return processed args on success', () => {
      const result = validateCommandMiddleware('add', {
        profileName: 'test',
        alias: 'testAlias',
      });

      expect(result.success).toBe(true);
      expect(result.validatedArgs).toEqual({
        profileName: 'test',
        alias: 'testAlias',
      });
    });

    it('should join multiple errors in message', () => {
      const result = validateCommandMiddleware('alias', {});

      expect(result.success).toBe(false);
      expect(result.message).toContain('Profile name is required and must be a string');
      expect(result.message).toContain('New alias is required and must be a string');
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('validationRules', () => {
    it('should export validation rules', () => {
      expect(validationRules).toBeDefined();
      expect(validationRules.add).toBeDefined();
      expect(validationRules.alias).toBeDefined();
      expect(validationRules.remove).toBeDefined();
      expect(validationRules.info).toBeDefined();
      expect(validationRules.activate).toBeDefined();
      expect(validationRules.autorespond).toBeDefined();
    });

    it('should have correct structure for add command', () => {
      expect(validationRules.add.required).toContain('profileName');
      expect(validationRules.add.optional).toContain('alias');
      expect(validationRules.add.types.profileName).toBe('string');
      expect(validationRules.add.errorMessages.profileName).toBeDefined();
    });

    it('should have custom validation for autorespond command', () => {
      expect(validationRules.autorespond.validation).toBeDefined();
      expect(validationRules.autorespond.validation.status).toBeDefined();
      expect(typeof validationRules.autorespond.validation.status).toBe('function');
    });
  });

  describe('edge cases', () => {
    it('should handle objects as parameters', () => {
      const result = validateCommand('add', {
        profileName: { name: 'test' },
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Profile name is required and must be a string');
    });

    it('should handle arrays as parameters', () => {
      const result = validateCommand('add', {
        profileName: ['test'],
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Profile name is required and must be a string');
    });

    it('should handle boolean as parameters', () => {
      const result = validateCommand('add', {
        profileName: true,
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Profile name is required and must be a string');
    });
  });
});
