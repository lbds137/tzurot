/**
 * Factory Index
 * Central export point for all test factories
 */

// Export everything from discord factory
const {
  createMockUser,
  createMockMember,
  createMockGuild,
  createMockTextChannel,
  createMockDMChannel,
  createMockThreadChannel,
  createMockAttachment,
  createMockEmbed,
  createMockWebhookClient,
  createMockCollection
} = require('./discord.factory');

// Export everything from message factory
const {
  MessageFactory,
  createGuildMessage,
  createDMMessage,
  createThreadMessage,
  createWebhookMessage,
  createMediaMessage,
  createMentionMessage,
  createReplyMessage
} = require('./message.factory');

module.exports = {
  // Discord mocks
  createMockUser,
  createMockMember,
  createMockGuild,
  createMockTextChannel,
  createMockDMChannel,
  createMockThreadChannel,
  createMockAttachment,
  createMockEmbed,
  createMockWebhookClient,
  createMockCollection,
  
  // Message factory
  MessageFactory,
  
  // Preset message creators
  createGuildMessage,
  createDMMessage,
  createThreadMessage,
  createWebhookMessage,
  createMediaMessage,
  createMentionMessage,
  createReplyMessage,
  
  // Convenience namespace for presets
  Factories: {
    createGuildMessage,
    createDMMessage,
    createThreadMessage,
    createWebhookMessage,
    createMediaMessage,
    createMentionMessage,
    createReplyMessage
  }
};