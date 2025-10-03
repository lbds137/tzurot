/**
 * Conversation domain module
 * @module domain/conversation
 */

const { Conversation } = require('./Conversation');
const { ConversationId } = require('./ConversationId');
const { ConversationSettings } = require('./ConversationSettings');
const { ConversationRepository } = require('./ConversationRepository');
const { Message } = require('./Message');
const { ChannelActivation } = require('./ChannelActivation');
const {
  ConversationStarted,
  MessageAdded,
  PersonalityAssigned,
  ConversationSettingsUpdated,
  ConversationEnded,
  AutoResponseTriggered,
} = require('./ConversationEvents');

module.exports = {
  // Aggregates
  Conversation,
  ChannelActivation,

  // Entities
  Message,

  // Value Objects
  ConversationId,
  ConversationSettings,

  // Repository
  ConversationRepository,

  // Events
  ConversationStarted,
  MessageAdded,
  PersonalityAssigned,
  ConversationSettingsUpdated,
  ConversationEnded,
  AutoResponseTriggered,
};
