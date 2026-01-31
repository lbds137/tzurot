/**
 * @jest-environment node
 * @testType index
 *
 * Conversation Domain Index Test
 * - Tests exports of the conversation domain module
 * - Verifies API surface and basic functionality
 * - Imports related domain objects for integration tests
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Module under test - NOT mocked!
const conversationDomain = require('../../../../src/domain/conversation/index');
const { PersonalityId } = require('../../../../src/domain/personality/PersonalityId');
const { UserId } = require('../../../../src/domain/personality/UserId');

describe('Conversation Domain Index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('exports', () => {
    it('should export all aggregates', () => {
      expect(conversationDomain.Conversation).toBeDefined();
      expect(typeof conversationDomain.Conversation).toBe('function');

      expect(conversationDomain.ChannelActivation).toBeDefined();
      expect(typeof conversationDomain.ChannelActivation).toBe('function');
    });

    it('should export all entities', () => {
      expect(conversationDomain.Message).toBeDefined();
      expect(typeof conversationDomain.Message).toBe('function');
    });

    it('should export all value objects', () => {
      expect(conversationDomain.ConversationId).toBeDefined();
      expect(typeof conversationDomain.ConversationId).toBe('function');

      expect(conversationDomain.ConversationSettings).toBeDefined();
      expect(typeof conversationDomain.ConversationSettings).toBe('function');
    });

    it('should export all repositories', () => {
      expect(conversationDomain.ConversationRepository).toBeDefined();
      expect(typeof conversationDomain.ConversationRepository).toBe('function');
    });

    it('should export all events', () => {
      expect(conversationDomain.ConversationStarted).toBeDefined();
      expect(typeof conversationDomain.ConversationStarted).toBe('function');

      expect(conversationDomain.MessageAdded).toBeDefined();
      expect(typeof conversationDomain.MessageAdded).toBe('function');

      expect(conversationDomain.PersonalityAssigned).toBeDefined();
      expect(typeof conversationDomain.PersonalityAssigned).toBe('function');

      expect(conversationDomain.ConversationSettingsUpdated).toBeDefined();
      expect(typeof conversationDomain.ConversationSettingsUpdated).toBe('function');

      expect(conversationDomain.ConversationEnded).toBeDefined();
      expect(typeof conversationDomain.ConversationEnded).toBe('function');

      expect(conversationDomain.AutoResponseTriggered).toBeDefined();
      expect(typeof conversationDomain.AutoResponseTriggered).toBe('function');
    });
  });

  describe('functionality', () => {
    it('should allow creating conversations', () => {
      const conversationId = new conversationDomain.ConversationId(
        '123456789012345678',
        '987654321098765432'
      );
      const personalityId = new PersonalityId('test-personality');
      const initialMessage = new conversationDomain.Message({
        id: 'msg-1',
        content: 'Hello',
        authorId: '123456789012345678',
        timestamp: new Date(),
        isFromPersonality: false,
        channelId: '987654321098765432',
      });

      const conversation = conversationDomain.Conversation.start(
        conversationId,
        initialMessage,
        personalityId
      );

      expect(conversation).toBeInstanceOf(conversationDomain.Conversation);
    });

    it('should allow creating conversation IDs', () => {
      const dmConversation = conversationDomain.ConversationId.forDM('123456789012345678');
      const channelConversation = new conversationDomain.ConversationId(
        '123456789012345678',
        '987654321098765432'
      );

      expect(dmConversation).toBeInstanceOf(conversationDomain.ConversationId);
      expect(channelConversation).toBeInstanceOf(conversationDomain.ConversationId);
    });

    it('should allow creating channel activations', () => {
      const personalityId = new PersonalityId('test-personality');
      const userId = new UserId('123456789012345678');

      const activation = conversationDomain.ChannelActivation.create(
        '987654321098765432',
        personalityId,
        userId
      );

      expect(activation).toBeInstanceOf(conversationDomain.ChannelActivation);
    });

    it('should allow creating conversation events', () => {
      const conversationId = new conversationDomain.ConversationId(
        '123456789012345678',
        '987654321098765432'
      );
      const message = new conversationDomain.Message({
        id: 'msg-1',
        content: 'Hello',
        authorId: '123456789012345678',
        timestamp: new Date(),
        isFromPersonality: false,
        channelId: '987654321098765432',
      });

      const event = new conversationDomain.ConversationStarted(conversationId.toString(), {
        conversationId: conversationId.toJSON(),
        initialMessage: message.toJSON(),
        personalityId: 'test-personality',
        startedAt: new Date().toISOString(),
        settings: conversationDomain.ConversationSettings.createDefault().toJSON(),
      });

      expect(event).toBeInstanceOf(conversationDomain.ConversationStarted);
    });
  });

  describe('domain boundary', () => {
    it('should not export internal implementation details', () => {
      // These should not be exported
      expect(conversationDomain.ConversationStatus).toBeUndefined();
      expect(conversationDomain.MessageType).toBeUndefined();
      expect(conversationDomain.ConversationHistory).toBeUndefined();
    });

    it('should provide complete public API', () => {
      const exportedKeys = Object.keys(conversationDomain);
      const expectedKeys = [
        'Conversation',
        'ChannelActivation',
        'Message',
        'ConversationId',
        'ConversationSettings',
        'ConversationRepository',
        'ConversationStarted',
        'MessageAdded',
        'PersonalityAssigned',
        'ConversationSettingsUpdated',
        'ConversationEnded',
        'AutoResponseTriggered',
      ];

      for (const key of expectedKeys) {
        expect(exportedKeys).toContain(key);
      }

      expect(exportedKeys).toHaveLength(expectedKeys.length);
    });
  });
});
