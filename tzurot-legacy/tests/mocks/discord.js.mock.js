/**
 * Legacy Discord Mock - Deprecated
 *
 * This file is kept for backward compatibility but should not be used in new tests.
 * Use the new consolidated mock system at tests/__mocks__/index.js instead.
 *
 * @deprecated Use require('../../__mocks__').discord instead
 */

const { createDiscordEnvironment } = require('../__mocks__/discord');

// Create a default environment for legacy compatibility
const defaultEnv = createDiscordEnvironment();

module.exports = {
  // Legacy exports for backward compatibility
  Client: defaultEnv.client.constructor,
  createMockMessage: defaultEnv.createMessage,
  createMockChannel: defaultEnv.createChannel,
  createMockUser: defaultEnv.createUser,

  // Warn about deprecation
  _deprecated: true,
  _message: 'This mock is deprecated. Use the consolidated system at tests/__mocks__/index.js',
};
