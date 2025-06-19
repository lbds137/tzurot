/**
 * Tests for the permissions middleware
 */

// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('../../../../src/commands/utils/commandValidator', () => ({
  isAdmin: jest.fn(),
  canManageMessages: jest.fn(),
  isNsfwChannel: jest.fn(),
  getPermissionErrorMessage: jest.fn(),
}));

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const logger = require('../../../../src/logger');
const validator = require('../../../../src/commands/utils/commandValidator');

describe('Permissions Middleware', () => {
  let permissionsMiddleware;
  let mockMessage;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock message
    mockMessage = helpers.createMockMessage();

    // Set up validator mock defaults
    validator.isAdmin.mockReturnValue(false);
    validator.canManageMessages.mockReturnValue(false);
    validator.isNsfwChannel.mockReturnValue(false);
    validator.getPermissionErrorMessage.mockImplementation(permission => {
      return `You need ${permission} permission to use this command.`;
    });

    // Import module after mock setup
    permissionsMiddleware = require('../../../../src/commands/middleware/permissions');
  });

  it('should allow commands with no permissions required', () => {
    // Command with no permissions
    const commandModule = {
      meta: {
        name: 'test',
        permissions: [],
      },
    };

    const result = permissionsMiddleware(mockMessage, 'test', commandModule);

    expect(result.hasPermission).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should allow when command module is not provided', () => {
    const result = permissionsMiddleware(mockMessage, 'test', null);

    expect(result.hasPermission).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should check ADMINISTRATOR permission correctly', () => {
    // Command requiring ADMINISTRATOR
    const commandModule = {
      meta: {
        name: 'admin-command',
        permissions: ['ADMINISTRATOR'],
      },
    };

    // Test without permission
    validator.isAdmin.mockReturnValue(false);
    let result = permissionsMiddleware(mockMessage, 'admin-command', commandModule);

    expect(result.hasPermission).toBe(false);
    expect(result.error).toBe('You need ADMINISTRATOR permission to use this command.');
    expect(validator.isAdmin).toHaveBeenCalledWith(mockMessage);
    expect(validator.getPermissionErrorMessage).toHaveBeenCalledWith(
      'ADMINISTRATOR',
      'admin-command'
    );

    // Test with permission
    validator.isAdmin.mockReturnValue(true);
    result = permissionsMiddleware(mockMessage, 'admin-command', commandModule);

    expect(result.hasPermission).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should check MANAGE_MESSAGES permission correctly', () => {
    // Command requiring MANAGE_MESSAGES
    const commandModule = {
      meta: {
        name: 'mod-command',
        permissions: ['MANAGE_MESSAGES'],
      },
    };

    // Test without permission
    validator.canManageMessages.mockReturnValue(false);
    let result = permissionsMiddleware(mockMessage, 'mod-command', commandModule);

    expect(result.hasPermission).toBe(false);
    expect(result.error).toBe('You need MANAGE_MESSAGES permission to use this command.');
    expect(validator.canManageMessages).toHaveBeenCalledWith(mockMessage);
    expect(validator.getPermissionErrorMessage).toHaveBeenCalledWith(
      'MANAGE_MESSAGES',
      'mod-command'
    );

    // Test with permission
    validator.canManageMessages.mockReturnValue(true);
    result = permissionsMiddleware(mockMessage, 'mod-command', commandModule);

    expect(result.hasPermission).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should check NSFW_CHANNEL permission correctly', () => {
    // Command requiring NSFW_CHANNEL
    const commandModule = {
      meta: {
        name: 'nsfw-command',
        permissions: ['NSFW_CHANNEL'],
      },
    };

    // Test without permission
    validator.isNsfwChannel.mockReturnValue(false);
    let result = permissionsMiddleware(mockMessage, 'nsfw-command', commandModule);

    expect(result.hasPermission).toBe(false);
    expect(result.error).toBe('You need NSFW_CHANNEL permission to use this command.');
    expect(validator.isNsfwChannel).toHaveBeenCalledWith(mockMessage.channel);
    expect(validator.getPermissionErrorMessage).toHaveBeenCalledWith(
      'NSFW_CHANNEL',
      'nsfw-command'
    );

    // Test with permission
    validator.isNsfwChannel.mockReturnValue(true);
    result = permissionsMiddleware(mockMessage, 'nsfw-command', commandModule);

    expect(result.hasPermission).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should check multiple permissions correctly', () => {
    // Command requiring multiple permissions
    const commandModule = {
      meta: {
        name: 'multi-perm-command',
        permissions: ['ADMINISTRATOR', 'MANAGE_MESSAGES'],
      },
    };

    // Test with no permissions
    validator.isAdmin.mockReturnValue(false);
    validator.canManageMessages.mockReturnValue(false);
    let result = permissionsMiddleware(mockMessage, 'multi-perm-command', commandModule);

    expect(result.hasPermission).toBe(false);
    expect(result.error).toBe('You need ADMINISTRATOR permission to use this command.');

    // Test with only ADMINISTRATOR
    validator.isAdmin.mockReturnValue(true);
    validator.canManageMessages.mockReturnValue(false);
    result = permissionsMiddleware(mockMessage, 'multi-perm-command', commandModule);

    expect(result.hasPermission).toBe(false);
    expect(result.error).toBe('You need MANAGE_MESSAGES permission to use this command.');

    // Test with all permissions
    validator.isAdmin.mockReturnValue(true);
    validator.canManageMessages.mockReturnValue(true);
    result = permissionsMiddleware(mockMessage, 'multi-perm-command', commandModule);

    expect(result.hasPermission).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should log warnings for unknown permissions', () => {
    // Command with unknown permission
    const commandModule = {
      meta: {
        name: 'unknown-perm-command',
        permissions: ['UNKNOWN_PERMISSION'],
      },
    };

    // Execute middleware
    const result = permissionsMiddleware(mockMessage, 'unknown-perm-command', commandModule);

    // Should pass but log a warning
    expect(result.hasPermission).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unknown permission requirement: UNKNOWN_PERMISSION')
    );
  });
});
