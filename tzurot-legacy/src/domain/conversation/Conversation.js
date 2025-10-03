/**
 * Conversation aggregate root
 * @module domain/conversation/Conversation
 */

const { AggregateRoot } = require('../shared/AggregateRoot');
const { ConversationId } = require('./ConversationId');
const { ConversationSettings } = require('./ConversationSettings');
const { Message } = require('./Message');
const { PersonalityId } = require('../personality/PersonalityId');
const {
  ConversationStarted,
  MessageAdded,
  PersonalityAssigned,
  ConversationSettingsUpdated,
  ConversationEnded,
} = require('./ConversationEvents');

/**
 * @class Conversation
 * @extends AggregateRoot
 * @description Aggregate root for conversation bounded context
 */
class Conversation extends AggregateRoot {
  constructor(id) {
    if (!(id instanceof ConversationId)) {
      throw new Error('Conversation must be created with ConversationId');
    }

    super(id.toString());

    this.conversationId = id;
    this.messages = [];
    this.activePersonalityId = null;
    this.settings = ConversationSettings.createDefault();
    this.startedAt = null;
    this.lastActivityAt = null;
    this.ended = false;
    this.endedAt = null;
  }

  /**
   * Start a new conversation
   * @static
   * @param {ConversationId} conversationId - Conversation identifier
   * @param {Message} initialMessage - First message
   * @param {PersonalityId} personalityId - Assigned personality
   * @returns {Conversation} New conversation
   */
  static start(conversationId, initialMessage, personalityId) {
    if (!(conversationId instanceof ConversationId)) {
      throw new Error('Invalid ConversationId');
    }

    if (!(initialMessage instanceof Message)) {
      throw new Error('Invalid initial message');
    }

    if (personalityId && !(personalityId instanceof PersonalityId)) {
      throw new Error('Invalid PersonalityId');
    }

    const conversation = new Conversation(conversationId);

    conversation.applyEvent(
      new ConversationStarted(conversationId.toString(), {
        conversationId: conversationId.toJSON(),
        initialMessage: initialMessage.toJSON(),
        personalityId: personalityId ? personalityId.toString() : null,
        startedAt: new Date().toISOString(),
        settings: conversationId.isDM()
          ? ConversationSettings.createForDM().toJSON()
          : ConversationSettings.createDefault().toJSON(),
      })
    );

    return conversation;
  }

  /**
   * Add a message to the conversation
   * @param {Message} message - Message to add
   */
  addMessage(message) {
    if (this.ended) {
      throw new Error('Cannot add message to ended conversation');
    }

    if (!(message instanceof Message)) {
      throw new Error('Invalid message');
    }

    // Check if conversation has timed out
    if (this.isTimedOut()) {
      this.end();
      throw new Error('Conversation has timed out');
    }

    this.applyEvent(
      new MessageAdded(this.id, {
        message: message.toJSON(),
        addedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Assign or change personality
   * @param {PersonalityId} personalityId - New personality
   */
  assignPersonality(personalityId) {
    if (this.ended) {
      throw new Error('Cannot assign personality to ended conversation');
    }

    if (!(personalityId instanceof PersonalityId)) {
      throw new Error('Invalid PersonalityId');
    }

    if (this.activePersonalityId?.equals(personalityId)) {
      return; // No change needed
    }

    this.applyEvent(
      new PersonalityAssigned(this.id, {
        personalityId: personalityId.toString(),
        previousPersonalityId: this.activePersonalityId?.toString() || null,
        assignedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Update conversation settings
   * @param {ConversationSettings} settings - New settings
   */
  updateSettings(settings) {
    if (this.ended) {
      throw new Error('Cannot update settings for ended conversation');
    }

    if (!(settings instanceof ConversationSettings)) {
      throw new Error('Invalid ConversationSettings');
    }

    if (this.settings.equals(settings)) {
      return; // No change needed
    }

    this.applyEvent(
      new ConversationSettingsUpdated(this.id, {
        settings: settings.toJSON(),
        updatedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * End the conversation
   */
  end() {
    if (this.ended) {
      return; // Already ended
    }

    this.applyEvent(
      new ConversationEnded(this.id, {
        endedAt: new Date().toISOString(),
        reason: this.isTimedOut() ? 'timeout' : 'manual',
      })
    );
  }

  /**
   * Check if conversation has timed out
   * @returns {boolean} True if timed out
   */
  isTimedOut() {
    if (!this.lastActivityAt || this.ended) {
      return false;
    }

    const lastActivity = new Date(this.lastActivityAt).getTime();
    const now = Date.now();

    return now - lastActivity > this.settings.timeoutMs;
  }

  /**
   * Check if auto-response should trigger
   * @returns {boolean} True if should auto-respond
   */
  shouldAutoRespond() {
    if (!this.settings.autoResponseEnabled || this.ended) {
      return false;
    }

    if (this.messages.length === 0) {
      return false;
    }

    const lastMessage = this.messages[this.messages.length - 1];

    // Don't auto-respond to personality messages
    if (lastMessage.isFromPersonality) {
      return false;
    }

    // Check if enough time has passed
    return lastMessage.getAge() >= this.settings.autoResponseDelay;
  }

  /**
   * Get the last message
   * @returns {Message|null} Last message or null
   */
  getLastMessage() {
    return this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
  }

  /**
   * Get message history
   * @param {number} limit - Max messages to return
   * @returns {Message[]} Recent messages
   */
  getRecentMessages(limit = 10) {
    return this.messages.slice(-limit);
  }

  // Event handlers
  onConversationStarted(event) {
    this.conversationId = ConversationId.fromString(event.aggregateId);
    this.messages = [Message.fromJSON(event.payload.initialMessage)];
    this.activePersonalityId = event.payload.personalityId
      ? PersonalityId.fromString(event.payload.personalityId)
      : null;
    this.settings = new ConversationSettings(event.payload.settings);
    this.startedAt = event.payload.startedAt;
    this.lastActivityAt = event.payload.startedAt;
    this.ended = false;
  }

  onMessageAdded(event) {
    this.messages.push(Message.fromJSON(event.payload.message));
    this.lastActivityAt = event.payload.addedAt;
  }

  onPersonalityAssigned(event) {
    this.activePersonalityId = PersonalityId.fromString(event.payload.personalityId);
  }

  onConversationSettingsUpdated(event) {
    this.settings = new ConversationSettings(event.payload.settings);
  }

  onConversationEnded(event) {
    this.ended = true;
    this.endedAt = event.payload.endedAt;
  }

  // Serialization
  toJSON() {
    return {
      id: this.id,
      conversationId: this.conversationId.toJSON(),
      messages: this.messages.map(m => m.toJSON()),
      activePersonalityId: this.activePersonalityId?.toString() || null,
      settings: this.settings.toJSON(),
      startedAt: this.startedAt,
      lastActivityAt: this.lastActivityAt,
      ended: this.ended,
      endedAt: this.endedAt,
      version: this.version,
    };
  }
}

module.exports = { Conversation };
