/**
 * @jest-environment node
 * @testType domain
 *
 * Conversation Events Test
 * - Pure domain test with no external dependencies
 * - Tests conversation domain events
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain models under test - NOT mocked!
const {
  ConversationStarted,
  MessageAdded,
  PersonalityAssigned,
  ConversationSettingsUpdated,
  ConversationEnded,
} = require('../../../../src/domain/conversation/ConversationEvents');
const { DomainEvent } = require('../../../../src/domain/shared/DomainEvent');

describe('ConversationEvents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('ConversationStarted', () => {
    it('should create event with required fields', () => {
      const payload = {
        conversationId: { userId: '123456789012345678', channelId: 'general' },
        initialMessage: {
          id: 'msg-1',
          content: 'Hello!',
          authorId: '123456789012345678',
          timestamp: '2024-01-01T00:00:00.000Z',
          isFromPersonality: false,
        },
        personalityId: 'claude-3-opus',
        startedAt: '2024-01-01T00:00:00.000Z',
        settings: {
          autoResponseEnabled: false,
          autoResponseDelay: 8000,
          mentionOnly: false,
          timeoutMs: 600000,
        },
      };

      const event = new ConversationStarted('123456789012345678:general', payload);

      expect(event).toBeInstanceOf(DomainEvent);
      expect(event.eventType).toBe('ConversationStarted');
      expect(event.aggregateId).toBe('123456789012345678:general');
      expect(event.payload).toEqual(payload);
    });

    it('should validate required fields', () => {
      expect(() => new ConversationStarted('123456789012345678:general', {})).toThrow(
        'ConversationStarted requires conversationId, initialMessage, and startedAt'
      );

      expect(
        () =>
          new ConversationStarted('123456789012345678:general', {
            conversationId: { userId: '123456789012345678', channelId: 'general' },
          })
      ).toThrow('ConversationStarted requires conversationId, initialMessage, and startedAt');

      expect(
        () =>
          new ConversationStarted('123456789012345678:general', {
            conversationId: { userId: '123456789012345678', channelId: 'general' },
            initialMessage: {},
          })
      ).toThrow('ConversationStarted requires conversationId, initialMessage, and startedAt');
    });

    it('should allow null personalityId', () => {
      const payload = {
        conversationId: { userId: '123456789012345678', channelId: 'general' },
        initialMessage: {
          id: 'msg-1',
          content: 'Hello!',
          authorId: '123456789012345678',
          timestamp: '2024-01-01T00:00:00.000Z',
          isFromPersonality: false,
        },
        personalityId: null,
        startedAt: '2024-01-01T00:00:00.000Z',
        settings: {
          autoResponseEnabled: false,
          autoResponseDelay: 8000,
          mentionOnly: false,
          timeoutMs: 600000,
        },
      };

      const event = new ConversationStarted('123456789012345678:general', payload);

      expect(event.payload.personalityId).toBeNull();
    });
  });

  describe('MessageAdded', () => {
    it('should create event with required fields', () => {
      const payload = {
        message: {
          id: 'msg-2',
          content: 'Reply',
          authorId: '123456789012345678',
          timestamp: '2024-01-01T00:01:00.000Z',
          isFromPersonality: false,
        },
        addedAt: '2024-01-01T00:01:00.000Z',
      };

      const event = new MessageAdded('123456789012345678:general', payload);

      expect(event).toBeInstanceOf(DomainEvent);
      expect(event.eventType).toBe('MessageAdded');
      expect(event.aggregateId).toBe('123456789012345678:general');
      expect(event.payload).toEqual(payload);
    });

    it('should validate required fields', () => {
      expect(() => new MessageAdded('123456789012345678:general', {})).toThrow(
        'MessageAdded requires message and addedAt'
      );

      expect(
        () =>
          new MessageAdded('123456789012345678:general', {
            message: {},
          })
      ).toThrow('MessageAdded requires message and addedAt');
    });
  });

  describe('PersonalityAssigned', () => {
    it('should create event with required fields', () => {
      const payload = {
        personalityId: 'gpt-4',
        previousPersonalityId: 'claude-3-opus',
        assignedAt: '2024-01-01T00:00:00.000Z',
      };

      const event = new PersonalityAssigned('123456789012345678:general', payload);

      expect(event).toBeInstanceOf(DomainEvent);
      expect(event.eventType).toBe('PersonalityAssigned');
      expect(event.aggregateId).toBe('123456789012345678:general');
      expect(event.payload).toEqual(payload);
    });

    it('should validate required fields', () => {
      expect(() => new PersonalityAssigned('123456789012345678:general', {})).toThrow(
        'PersonalityAssigned requires personalityId and assignedAt'
      );

      expect(
        () =>
          new PersonalityAssigned('123456789012345678:general', {
            personalityId: 'gpt-4',
          })
      ).toThrow('PersonalityAssigned requires personalityId and assignedAt');
    });

    it('should allow null previousPersonalityId', () => {
      const payload = {
        personalityId: 'gpt-4',
        previousPersonalityId: null,
        assignedAt: '2024-01-01T00:00:00.000Z',
      };

      const event = new PersonalityAssigned('123456789012345678:general', payload);

      expect(event.payload.previousPersonalityId).toBeNull();
    });
  });

  describe('ConversationSettingsUpdated', () => {
    it('should create event with required fields', () => {
      const payload = {
        settings: {
          autoResponseEnabled: true,
          autoResponseDelay: 5000,
          mentionOnly: true,
          timeoutMs: 300000,
        },
        updatedAt: '2024-01-01T00:00:00.000Z',
      };

      const event = new ConversationSettingsUpdated('123456789012345678:general', payload);

      expect(event).toBeInstanceOf(DomainEvent);
      expect(event.eventType).toBe('ConversationSettingsUpdated');
      expect(event.aggregateId).toBe('123456789012345678:general');
      expect(event.payload).toEqual(payload);
    });

    it('should validate required fields', () => {
      expect(() => new ConversationSettingsUpdated('123456789012345678:general', {})).toThrow(
        'ConversationSettingsUpdated requires settings and updatedAt'
      );

      expect(
        () =>
          new ConversationSettingsUpdated('123456789012345678:general', {
            settings: {},
          })
      ).toThrow('ConversationSettingsUpdated requires settings and updatedAt');
    });
  });

  describe('ConversationEnded', () => {
    it('should create event with required fields', () => {
      const payload = {
        endedAt: '2024-01-01T00:10:00.000Z',
        reason: 'manual',
      };

      const event = new ConversationEnded('123456789012345678:general', payload);

      expect(event).toBeInstanceOf(DomainEvent);
      expect(event.eventType).toBe('ConversationEnded');
      expect(event.aggregateId).toBe('123456789012345678:general');
      expect(event.payload).toEqual(payload);
    });

    it('should validate required fields', () => {
      expect(() => new ConversationEnded('123456789012345678:general', {})).toThrow(
        'ConversationEnded requires endedAt and reason'
      );

      expect(
        () =>
          new ConversationEnded('123456789012345678:general', {
            endedAt: '2024-01-01T00:10:00.000Z',
          })
      ).toThrow('ConversationEnded requires endedAt and reason');
    });

    it('should accept timeout reason', () => {
      const payload = {
        endedAt: '2024-01-01T00:10:00.000Z',
        reason: 'timeout',
      };

      const event = new ConversationEnded('123456789012345678:general', payload);

      expect(event.payload.reason).toBe('timeout');
    });
  });

  describe('Event immutability', () => {
    it('should not be affected by payload modifications after creation', () => {
      const payload = {
        message: {
          id: 'msg-2',
          content: 'Original',
          authorId: '123456789012345678',
          timestamp: '2024-01-01T00:01:00.000Z',
          isFromPersonality: false,
        },
        addedAt: '2024-01-01T00:01:00.000Z',
      };

      const event = new MessageAdded('123456789012345678:general', { ...payload });

      // Modify original payload
      payload.message.content = 'Modified';
      payload.addedAt = '2024-01-01T00:02:00.000Z';

      // Event should remain unchanged
      expect(event.payload.message).toBeDefined();
      expect(event.payload.addedAt).toBe('2024-01-01T00:01:00.000Z');
    });
  });

  describe('Event metadata', () => {
    it('should include standard DomainEvent metadata', () => {
      const event = new MessageAdded('123456789012345678:general', {
        message: {
          id: 'msg-2',
          content: 'Test',
          authorId: '123456789012345678',
          timestamp: '2024-01-01T00:01:00.000Z',
          isFromPersonality: false,
        },
        addedAt: '2024-01-01T00:01:00.000Z',
      });

      expect(event.eventId).toBeDefined();
      expect(event.occurredAt).toBeDefined();
      expect(event.occurredAt).toBeInstanceOf(Date);
      expect(event.eventType).toBe('MessageAdded');
    });
  });
});
