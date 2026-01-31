/**
 * Centralized Mock Registry
 * This file provides a single entry point for all mock implementations
 * to avoid duplication and ensure consistency across tests
 */

// Import all mock factories and utilities
const discordMocks = require('../__mocks__/discord');
const apiMocks = require('../__mocks__/api');
const moduleMocks = require('../__mocks__/modules');
const dddMocks = require('../__mocks__/ddd');

/**
 * Create a complete mock environment for tests
 * @param {Object} options - Configuration options for mocks
 * @returns {Object} Complete mock environment
 */
function createTestEnvironment(options = {}) {
  return {
    discord: discordMocks.createDiscordEnvironment(options.discord),
    api: apiMocks.createApiEnvironment(options.api),
    modules: moduleMocks.createModuleEnvironment(options.modules),
  };
}

/**
 * Quick setup for common test scenarios
 */
const presets = {
  /**
   * Standard command test setup
   */
  commandTest: (options = {}) =>
    createTestEnvironment({
      discord: {
        userPermissions: options.userPermissions || ['ADMINISTRATOR'],
        channelType: options.channelType || 'text',
        ...options.discord,
      },
      modules: {
        personalityManager: true,
        conversationManager: true,
        ...options.modules,
      },
    }),

  /**
   * Webhook/AI response test setup
   */
  webhookTest: (options = {}) =>
    createTestEnvironment({
      discord: {
        webhookSupport: true,
        ...options.discord,
      },
      api: {
        aiService: true,
        mockResponses: options.mockResponses || {},
        ...options.api,
      },
      modules: {
        webhookManager: true,
        ...options.modules,
      },
    }),

  /**
   * Integration test setup
   */
  integrationTest: (options = {}) =>
    createTestEnvironment({
      discord: { fullSupport: true, ...options.discord },
      api: { fullSupport: true, ...options.api },
      modules: { fullSupport: true, ...options.modules },
    }),
};

module.exports = {
  createTestEnvironment,
  presets: {
    ...presets,
    ...dddMocks.presets, // Include DDD presets
  },
  // Re-export individual mock utilities for fine-grained control
  discord: discordMocks,
  api: apiMocks,
  modules: moduleMocks,
  ddd: dddMocks,
};
