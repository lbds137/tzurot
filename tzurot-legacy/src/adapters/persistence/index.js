/**
 * Persistence Adapter exports
 * @module adapters/persistence
 */

const { FilePersonalityRepository } = require('./FilePersonalityRepository');
const { FileConversationRepository } = require('./FileConversationRepository');
const { FileAuthenticationRepository } = require('./FileAuthenticationRepository');
const { MemoryConversationRepository } = require('./MemoryConversationRepository');

module.exports = {
  FilePersonalityRepository,
  FileConversationRepository,
  FileAuthenticationRepository,
  MemoryConversationRepository,
};
