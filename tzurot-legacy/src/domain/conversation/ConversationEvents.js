/**
 * Conversation domain events
 * @module domain/conversation/ConversationEvents
 */

const { DomainEvent } = require('../shared/DomainEvent');

/**
 * @class ConversationStarted
 * @extends DomainEvent
 * @description Event emitted when a conversation starts
 */
class ConversationStarted extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.conversationId || !payload.initialMessage || !payload.startedAt) {
      throw new Error('ConversationStarted requires conversationId, initialMessage, and startedAt');
    }
  }
}

/**
 * @class MessageAdded
 * @extends DomainEvent
 * @description Event emitted when a message is added to conversation
 */
class MessageAdded extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.message || !payload.addedAt) {
      throw new Error('MessageAdded requires message and addedAt');
    }
  }
}

/**
 * @class PersonalityAssigned
 * @extends DomainEvent
 * @description Event emitted when personality is assigned to conversation
 */
class PersonalityAssigned extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.personalityId || !payload.assignedAt) {
      throw new Error('PersonalityAssigned requires personalityId and assignedAt');
    }
  }
}

/**
 * @class ConversationSettingsUpdated
 * @extends DomainEvent
 * @description Event emitted when conversation settings are updated
 */
class ConversationSettingsUpdated extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.settings || !payload.updatedAt) {
      throw new Error('ConversationSettingsUpdated requires settings and updatedAt');
    }
  }
}

/**
 * @class ConversationEnded
 * @extends DomainEvent
 * @description Event emitted when a conversation ends
 */
class ConversationEnded extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.endedAt || !payload.reason) {
      throw new Error('ConversationEnded requires endedAt and reason');
    }
  }
}

/**
 * @class AutoResponseTriggered
 * @extends DomainEvent
 * @description Event emitted when auto-response is triggered
 */
class AutoResponseTriggered extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.messageId || !payload.triggeredAt) {
      throw new Error('AutoResponseTriggered requires messageId and triggeredAt');
    }
  }
}

module.exports = {
  ConversationStarted,
  MessageAdded,
  PersonalityAssigned,
  ConversationSettingsUpdated,
  ConversationEnded,
  AutoResponseTriggered,
};
