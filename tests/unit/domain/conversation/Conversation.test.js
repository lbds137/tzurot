/**
 * @jest-environment node
 * @testType domain
 *
 * Conversation Aggregate Test
 * - Pure domain test with no external dependencies
 * - Tests conversation aggregate with event sourcing
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain models under test - NOT mocked!
const { Conversation } = require('../../../../src/domain/conversation/Conversation');
const { ConversationId } = require('../../../../src/domain/conversation/ConversationId');
const {
  ConversationSettings,
} = require('../../../../src/domain/conversation/ConversationSettings');
const { Message } = require('../../../../src/domain/conversation/Message');
const { PersonalityId } = require('../../../../src/domain/personality/PersonalityId');
const {
  ConversationStarted,
  MessageAdded,
  PersonalityAssigned,
  ConversationSettingsUpdated,
  ConversationEnded,
} = require('../../../../src/domain/conversation/ConversationEvents');

describe('Conversation', () => {
  let conversationId;
  let personalityId;
  let message;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    conversationId = new ConversationId('123456789012345678', 'general');
    personalityId = new PersonalityId('claude-3-opus');
    message = new Message({
      id: 'msg-1',
      content: 'Hello!',
      authorId: '123456789012345678',
      timestamp: new Date(),
      isFromPersonality: false,
      channelId: 'general',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should require ConversationId', () => {
      expect(() => new Conversation('string-id')).toThrow(
        'Conversation must be created with ConversationId'
      );
    });

    it('should initialize with ConversationId', () => {
      const conversation = new Conversation(conversationId);

      expect(conversation.id).toBe(conversationId.toString());
      expect(conversation.conversationId).toBe(conversationId);
      expect(conversation.messages).toEqual([]);
      expect(conversation.activePersonalityId).toBeNull();
      expect(conversation.settings).toBeDefined();
      expect(conversation.ended).toBe(false);
    });
  });

  describe('start', () => {
    it('should start new conversation with message and personality', () => {
      const conversation = Conversation.start(conversationId, message, personalityId);

      expect(conversation).toBeInstanceOf(Conversation);
      expect(conversation.conversationId).toEqual(conversationId);
      expect(conversation.messages).toHaveLength(1);
      expect(conversation.messages[0]).toEqual(message);
      expect(conversation.activePersonalityId).toEqual(personalityId);
      expect(conversation.startedAt).toBeDefined();
      expect(conversation.ended).toBe(false);
      expect(conversation.version).toBe(1);
    });

    it('should emit ConversationStarted event', () => {
      const conversation = Conversation.start(conversationId, message, personalityId);
      const events = conversation.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(ConversationStarted);
      expect(events[0].payload).toMatchObject({
        conversationId: conversationId.toJSON(),
        personalityId: personalityId.toString(),
      });
    });

    it('should start without personality', () => {
      const conversation = Conversation.start(conversationId, message, null);

      expect(conversation.activePersonalityId).toBeNull();
    });

    it('should use DM settings for DM conversations', () => {
      const dmConversationId = ConversationId.forDM('123456789012345678');
      const conversation = Conversation.start(dmConversationId, message, personalityId);

      // DM conversations have auto-response enabled by default
      expect(conversation.settings.autoResponseEnabled).toBe(true);
      expect(conversation.settings.mentionOnly).toBe(false);
    });

    it('should validate ConversationId', () => {
      expect(() => Conversation.start('invalid', message, personalityId)).toThrow(
        'Invalid ConversationId'
      );
    });

    it('should validate Message', () => {
      expect(() => Conversation.start(conversationId, 'invalid', personalityId)).toThrow(
        'Invalid initial message'
      );
    });

    it('should validate PersonalityId', () => {
      expect(() => Conversation.start(conversationId, message, 'invalid')).toThrow(
        'Invalid PersonalityId'
      );
    });
  });

  describe('addMessage', () => {
    let conversation;

    beforeEach(() => {
      conversation = Conversation.start(conversationId, message, personalityId);
      conversation.markEventsAsCommitted();
    });

    it('should add message to conversation', () => {
      const newMessage = new Message({
        id: 'msg-2',
        content: 'Second message',
        authorId: '123456789012345678',
        timestamp: new Date(),
        isFromPersonality: false,
        channelId: 'test-channel-123',
      });

      conversation.addMessage(newMessage);

      expect(conversation.messages).toHaveLength(2);
      expect(conversation.messages[1]).toEqual(newMessage);
      expect(conversation.lastActivityAt).toBeDefined();
    });

    it('should emit MessageAdded event', () => {
      const newMessage = new Message({
        id: 'msg-2',
        content: 'Second message',
        authorId: '123456789012345678',
        timestamp: new Date(),
        isFromPersonality: false,
        channelId: 'test-channel-123',
      });

      conversation.addMessage(newMessage);
      const events = conversation.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(MessageAdded);
      expect(events[0].payload.message).toEqual(newMessage.toJSON());
    });

    it('should reject invalid message', () => {
      expect(() => conversation.addMessage('invalid')).toThrow('Invalid message');
    });

    it('should reject adding to ended conversation', () => {
      conversation.end();
      const newMessage = new Message({
        id: 'msg-2',
        content: 'Test',
        authorId: '123456789012345678',
        timestamp: new Date(),
        isFromPersonality: false,
        channelId: 'test-channel-123',
      });

      expect(() => conversation.addMessage(newMessage)).toThrow(
        'Cannot add message to ended conversation'
      );
    });

    it('should end conversation if timed out', () => {
      // Advance time past timeout
      jest.advanceTimersByTime(conversation.settings.timeoutMs + 1);

      const newMessage = new Message({
        id: 'msg-2',
        content: 'Test',
        authorId: '123456789012345678',
        timestamp: new Date(),
        isFromPersonality: false,
        channelId: 'test-channel-123',
      });

      expect(() => conversation.addMessage(newMessage)).toThrow('Conversation has timed out');
      expect(conversation.ended).toBe(true);
    });
  });

  describe('assignPersonality', () => {
    let conversation;

    beforeEach(() => {
      conversation = Conversation.start(conversationId, message, personalityId);
      conversation.markEventsAsCommitted();
    });

    it('should assign new personality', () => {
      const newPersonalityId = new PersonalityId('gpt-4');

      conversation.assignPersonality(newPersonalityId);

      expect(conversation.activePersonalityId).toEqual(newPersonalityId);
    });

    it('should emit PersonalityAssigned event', () => {
      const newPersonalityId = new PersonalityId('gpt-4');

      conversation.assignPersonality(newPersonalityId);
      const events = conversation.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(PersonalityAssigned);
      expect(events[0].payload).toMatchObject({
        personalityId: 'gpt-4',
        previousPersonalityId: 'claude-3-opus',
      });
    });

    it('should not emit event if same personality', () => {
      conversation.assignPersonality(personalityId);

      expect(conversation.getUncommittedEvents()).toHaveLength(0);
    });

    it('should reject invalid PersonalityId', () => {
      expect(() => conversation.assignPersonality('invalid')).toThrow('Invalid PersonalityId');
    });

    it('should reject if conversation ended', () => {
      conversation.end();
      const newPersonalityId = new PersonalityId('gpt-4');

      expect(() => conversation.assignPersonality(newPersonalityId)).toThrow(
        'Cannot assign personality to ended conversation'
      );
    });
  });

  describe('updateSettings', () => {
    let conversation;

    beforeEach(() => {
      conversation = Conversation.start(conversationId, message, personalityId);
      conversation.markEventsAsCommitted();
    });

    it('should update settings', () => {
      const newSettings = new ConversationSettings({
        autoResponseEnabled: false,
        autoResponseDelay: 2000,
        timeoutMs: 600000,
        isDM: false,
      });

      conversation.updateSettings(newSettings);

      expect(conversation.settings).toEqual(newSettings);
    });

    it('should emit ConversationSettingsUpdated event', () => {
      const newSettings = new ConversationSettings({
        autoResponseEnabled: false,
        autoResponseDelay: 2000,
        timeoutMs: 600000,
        isDM: false,
      });

      conversation.updateSettings(newSettings);
      const events = conversation.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(ConversationSettingsUpdated);
      expect(events[0].payload.settings).toEqual(newSettings.toJSON());
    });

    it('should not emit event if settings unchanged', () => {
      conversation.updateSettings(conversation.settings);

      expect(conversation.getUncommittedEvents()).toHaveLength(0);
    });

    it('should reject invalid settings', () => {
      expect(() => conversation.updateSettings({})).toThrow('Invalid ConversationSettings');
    });

    it('should reject if conversation ended', () => {
      conversation.end();
      const newSettings = ConversationSettings.createDefault();

      expect(() => conversation.updateSettings(newSettings)).toThrow(
        'Cannot update settings for ended conversation'
      );
    });
  });

  describe('end', () => {
    let conversation;

    beforeEach(() => {
      conversation = Conversation.start(conversationId, message, personalityId);
      conversation.markEventsAsCommitted();
    });

    it('should end conversation', () => {
      conversation.end();

      expect(conversation.ended).toBe(true);
    });

    it('should emit ConversationEnded event', () => {
      conversation.end();
      const events = conversation.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(ConversationEnded);
      expect(events[0].payload.reason).toBe('manual');
    });

    it('should not emit event if already ended', () => {
      conversation.end();
      conversation.markEventsAsCommitted();

      conversation.end();

      expect(conversation.getUncommittedEvents()).toHaveLength(0);
    });

    it('should mark as timeout if timed out', () => {
      jest.advanceTimersByTime(conversation.settings.timeoutMs + 1);

      conversation.end();
      const events = conversation.getUncommittedEvents();

      expect(events[0].payload.reason).toBe('timeout');
    });
  });

  describe('isTimedOut', () => {
    let conversation;

    beforeEach(() => {
      conversation = Conversation.start(conversationId, message, personalityId);
    });

    it('should return false for active conversation', () => {
      expect(conversation.isTimedOut()).toBe(false);
    });

    it('should return true after timeout period', () => {
      jest.advanceTimersByTime(conversation.settings.timeoutMs + 1);

      expect(conversation.isTimedOut()).toBe(true);
    });

    it('should return false for ended conversation', () => {
      jest.advanceTimersByTime(conversation.settings.timeoutMs + 1);
      conversation.end();

      expect(conversation.isTimedOut()).toBe(false);
    });
  });

  describe('shouldAutoRespond', () => {
    let conversation;

    beforeEach(() => {
      conversation = Conversation.start(conversationId, message, personalityId);
      // Enable auto-response for testing
      const settings = new ConversationSettings({
        autoResponseEnabled: true,
        autoResponseDelay: 1000,
        timeoutMs: 300000,
      });
      conversation.updateSettings(settings);
      conversation.markEventsAsCommitted();
    });

    it('should return false immediately after user message', () => {
      expect(conversation.shouldAutoRespond()).toBe(false);
    });

    it('should return true after auto-response delay', () => {
      jest.advanceTimersByTime(conversation.settings.autoResponseDelay);

      expect(conversation.shouldAutoRespond()).toBe(true);
    });

    it('should return false if auto-response disabled', () => {
      const settings = new ConversationSettings({
        autoResponseEnabled: false,
        autoResponseDelay: 1000,
        timeoutMs: 300000,
        isDM: false,
      });
      conversation.updateSettings(settings);

      jest.advanceTimersByTime(2000);

      expect(conversation.shouldAutoRespond()).toBe(false);
    });

    it('should return false after personality message', () => {
      const personalityMessage = new Message({
        id: 'msg-2',
        content: 'Hello from personality!',
        authorId: personalityId.toString(),
        personalityId: personalityId.toString(),
        timestamp: new Date(),
        isFromPersonality: true,
        channelId: 'test-channel-123',
      });
      conversation.addMessage(personalityMessage);

      jest.advanceTimersByTime(conversation.settings.autoResponseDelay);

      expect(conversation.shouldAutoRespond()).toBe(false);
    });

    it('should return false for ended conversation', () => {
      conversation.end();
      jest.advanceTimersByTime(conversation.settings.autoResponseDelay);

      expect(conversation.shouldAutoRespond()).toBe(false);
    });
  });

  describe('getLastMessage', () => {
    it('should return last message', () => {
      const conversation = Conversation.start(conversationId, message, personalityId);
      const secondMessage = new Message({
        id: 'msg-2',
        content: 'Second',
        authorId: '123456789012345678',
        timestamp: new Date(),
        isFromPersonality: false,
        channelId: 'test-channel-123',
      });
      conversation.addMessage(secondMessage);

      expect(conversation.getLastMessage()).toEqual(secondMessage);
    });

    it('should return null for empty conversation', () => {
      const conversation = new Conversation(conversationId);

      expect(conversation.getLastMessage()).toBeNull();
    });
  });

  describe('getRecentMessages', () => {
    it('should return recent messages with limit', () => {
      const conversation = Conversation.start(conversationId, message, personalityId);

      // Add more messages
      for (let i = 1; i <= 20; i++) {
        conversation.addMessage(
          new Message({
            id: `msg-${i + 1}`,
            content: `Message ${i}`,
            authorId: '123456789012345678',
            timestamp: new Date(),
            isFromPersonality: false,
            channelId: 'test-channel-123',
          })
        );
      }

      const recent = conversation.getRecentMessages(5);

      expect(recent).toHaveLength(5);
      expect(recent[0].content).toBe('Message 16');
      expect(recent[4].content).toBe('Message 20');
    });

    it('should return all messages if less than limit', () => {
      const conversation = Conversation.start(conversationId, message, personalityId);

      expect(conversation.getRecentMessages(10)).toHaveLength(1);
    });
  });

  describe('event sourcing', () => {
    it('should rebuild state from events', () => {
      const events = [
        new ConversationStarted('123456789012345678:general', {
          conversationId: conversationId.toJSON(),
          initialMessage: message.toJSON(),
          personalityId: 'claude-3-opus',
          startedAt: new Date().toISOString(),
          settings: ConversationSettings.createDefault().toJSON(),
        }),
        new MessageAdded('123456789012345678:general', {
          message: new Message({
            id: 'msg-2',
            content: 'Second',
            authorId: '123456789012345678',
            timestamp: new Date(),
            isFromPersonality: false,
            channelId: 'test-channel-123',
          }).toJSON(),
          addedAt: new Date().toISOString(),
        }),
        new PersonalityAssigned('123456789012345678:general', {
          personalityId: 'gpt-4',
          previousPersonalityId: 'claude-3-opus',
          assignedAt: new Date().toISOString(),
        }),
      ];

      const conversation = new Conversation(conversationId);
      conversation.loadFromHistory(events);

      expect(conversation.messages).toHaveLength(2);
      expect(conversation.activePersonalityId.value).toBe('gpt-4');
      expect(conversation.version).toBe(3);
      expect(conversation.ended).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should serialize conversation to JSON', () => {
      const conversation = Conversation.start(conversationId, message, personalityId);

      const json = conversation.toJSON();

      expect(json).toMatchObject({
        id: conversationId.toString(),
        conversationId: conversationId.toJSON(),
        messages: [message.toJSON()],
        activePersonalityId: personalityId.toString(),
        ended: false,
        version: 1,
      });
      expect(json.startedAt).toBeDefined();
      expect(json.lastActivityAt).toBeDefined();
      expect(json.settings).toBeDefined();
    });
  });
});
