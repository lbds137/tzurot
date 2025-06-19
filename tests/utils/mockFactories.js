/**
 * Mock Factories
 * Helper functions to create standardized mocks for common dependencies
 */

/**
 * Creates a standardized mock for the validator module
 * @param {Object} options - Configuration options
 * @returns {Object} Mocked validator module
 */
function createValidatorMock(options = {}) {
  // Default options
  const defaults = {
    isAdmin: false,
    canManageMessages: false,
    isNsfwChannel: false,
  };

  const config = { ...defaults, ...options };

  // Create the mock with the specified implementation
  return {
    createDirectSend: jest.fn().mockImplementation(message => {
      return content => {
        if (message && message.channel && message.channel.send) {
          return message.channel.send(content);
        }
        return Promise.resolve({
          id: 'direct-send-123',
          content: typeof content === 'string' ? content : 'embed message',
        });
      };
    }),
    isAdmin: jest.fn().mockReturnValue(config.isAdmin),
    canManageMessages: jest.fn().mockReturnValue(config.canManageMessages),
    isNsfwChannel: jest.fn().mockReturnValue(config.isNsfwChannel),
    getPermissionErrorMessage: jest.fn().mockReturnValue('Permission error message'),
  };
}

/**
 * Creates a standardized mock for the personality manager
 * @param {Object} options - Configuration options
 * @returns {Object} Mocked personality manager
 */
function createPersonalityManagerMock(options = {}) {
  // Default options
  const defaults = {
    defaultPersonality: {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png',
    },
    defaultAlias: null,
    removeSuccess: true,
  };

  const config = { ...defaults, ...options };

  return {
    getPersonality: jest.fn().mockReturnValue(config.defaultPersonality),
    getPersonalityByAlias: jest.fn().mockReturnValue(config.defaultAlias),
    removePersonality: jest.fn().mockResolvedValue({
      success: config.removeSuccess,
    }),
    addPersonality: jest.fn().mockResolvedValue({
      success: true,
    }),
    addAlias: jest.fn().mockResolvedValue({
      success: true,
    }),
    listPersonalitiesForUser: jest.fn().mockReturnValue([config.defaultPersonality]),
    activatePersonality: jest.fn().mockReturnValue(true),
    deactivatePersonality: jest.fn().mockReturnValue(true),
    getActivatedPersonality: jest.fn().mockReturnValue(null),
  };
}

/**
 * Creates a standardized mock for the Discord EmbedBuilder
 * @returns {Function} Mocked EmbedBuilder constructor
 */
function createEmbedBuilderMock() {
  // Create a mock implementation that returns itself for chaining
  const mockEmbed = {
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    setThumbnail: jest.fn().mockReturnThis(),
    setImage: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({
      title: 'Test Embed',
      description: 'Test description',
      color: 0x0099ff,
    }),
  };

  return jest.fn().mockImplementation(() => mockEmbed);
}

/**
 * Creates a standardized mock for the conversation manager
 * @param {Object} options - Configuration options
 * @returns {Object} Mocked conversation manager
 */
function createConversationManagerMock(options = {}) {
  // Default options
  const defaults = {
    hasActiveConversation: false,
    autoRespondEnabled: false,
    clearSuccess: true,
  };

  const config = { ...defaults, ...options };

  return {
    hasActiveConversation: jest.fn().mockReturnValue(config.hasActiveConversation),
    isAutoRespondEnabled: jest.fn().mockReturnValue(config.autoRespondEnabled),
    trackMessage: jest.fn().mockReturnValue(true),
    getLastPersonalityForChannel: jest.fn().mockReturnValue(null),
    clearConversation: jest.fn().mockReturnValue(config.clearSuccess),
    setAutoRespond: jest.fn().mockReturnValue(true),
    isReferencedMessageFromPersonality: jest.fn().mockReturnValue(false),
    getPersonalityFromReferencedMessage: jest.fn().mockReturnValue(null),
  };
}

/**
 * Setup mock implementations for common dependencies in a test file
 * Call this function before importing any modules
 *
 * Usage example:
 * // At the top of your test file
 * jest.mock('discord.js');
 * jest.mock('../../../src/logger');
 * jest.mock('../../../config', () => ({ botPrefix: '!tz' }));
 *
 * const mockValidator = require('../../utils/mockFactories').createValidatorMock();
 * jest.mock('../../../src/commands/utils/commandValidator', () => mockValidator);
 *
 * const mockPersonalityManager = require('../../utils/mockFactories').createPersonalityManagerMock();
 * jest.mock('../../../src/personalityManager', () => mockPersonalityManager);
 */

module.exports = {
  createValidatorMock,
  createPersonalityManagerMock,
  createEmbedBuilderMock,
  createConversationManagerMock,
};
