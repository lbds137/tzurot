/**
 * Bridge Utilities for Mock System Integration
 *
 * These utilities help connect the new consolidated mock system with Jest's
 * module replacement system, allowing for gradual migration from the old
 * scattered approach to the new unified approach.
 */

const { presets, modules, discord, api } = require('./index');

/**
 * Get a mock environment for use in tests
 * This creates mock objects but doesn't set up Jest mocks (those need to be done manually)
 *
 * @param {Object} options - Configuration options
 * @param {string} options.preset - Preset to use ('commandTest', 'webhookTest', 'integrationTest')
 * @returns {Object} Mock environment for use in tests
 */
function getMockEnvironment(options = {}) {
  const { preset = 'commandTest' } = options;
  return presets[preset](options);
}

/**
 * Setup common Jest mocks that work with the new system
 * Call this function in your beforeEach() after setting up mocks
 *
 * @param {Object} mockEnv - Mock environment from getMockEnvironment
 * @param {Object} customMocks - Additional custom mocks
 */
function setupCommonMocks(mockEnv, customMocks = {}) {
  // Legacy personality manager removed - using DDD system now

  if (mockEnv.modules.conversationManager) {
    require('../../../../src/conversationManager');
    Object.assign(
      require.cache[require.resolve('../../../../src/conversationManager')].exports,
      mockEnv.modules.conversationManager
    );
  }

  // Apply custom mocks
  Object.entries(customMocks).forEach(([modulePath, mockValue]) => {
    try {
      require(modulePath);
      Object.assign(require.cache[require.resolve(modulePath)].exports, mockValue);
    } catch (e) {
      // Module might not exist or be required yet
    }
  });
}

/**
 * Create a mock message using the new system but compatible with old test patterns
 * This helps during migration when tests expect certain mock message properties
 *
 * @param {Object} options - Message options
 * @returns {Object} Mock message object
 */
function createCompatibleMockMessage(options = {}) {
  const mockEnv = presets.commandTest();
  const message = mockEnv.discord.createMessage(options);

  // Add compatibility methods that some old tests might expect
  message.channel.sendTyping = message.channel.sendTyping || jest.fn().mockResolvedValue(undefined);
  message.author.send = message.author.send || jest.fn().mockResolvedValue({ id: 'dm-message' });

  return message;
}

/**
 * Setup command validator mock using new system
 * This is commonly needed in command tests
 *
 * @param {Object} options - Validator options
 * @returns {Object} Mock validator
 */
function createCommandValidatorMock(options = {}) {
  const mockEnv = presets.commandTest();
  const mockMessage = mockEnv.discord.createMessage();

  const mockDirectSend = jest.fn().mockImplementation(content => {
    return mockMessage.channel.send(content);
  });

  return {
    createDirectSend: jest.fn().mockReturnValue(mockDirectSend),
    isAdmin: jest.fn().mockReturnValue(options.isAdmin || false),
    canManageMessages: jest.fn().mockReturnValue(options.canManageMessages || false),
    isNsfwChannel: jest.fn().mockReturnValue(options.isNsfwChannel || false),
    ...options.overrides,
  };
}

/**
 * Utility to help migrate tests incrementally
 * Provides both old and new mock patterns side by side
 *
 * @param {Object} options - Migration options
 * @returns {Object} Both old and new mock objects for comparison/migration
 */
function createMigrationHelpers(options = {}) {
  const mockEnv = presets.commandTest(options);

  return {
    // New system (target)
    new: mockEnv,

    // Bridge helpers for common patterns
    createMessage: opts => createCompatibleMockMessage(opts),
    createValidator: opts => createCommandValidatorMock(opts),

    // Commonly used Jest mocks
    setupJest: () => setupJestMocks({ preset: 'commandTest', ...options }),
  };
}

module.exports = {
  getMockEnvironment,
  setupCommonMocks,
  createCompatibleMockMessage,
  createCommandValidatorMock,
  createMigrationHelpers,
};
