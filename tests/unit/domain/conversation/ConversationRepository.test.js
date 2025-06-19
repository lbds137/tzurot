/**
 * @jest-environment node
 * @testType domain
 *
 * ConversationRepository Interface Test
 * - Tests repository interface contract
 * - Includes mock implementation example
 * - Pure domain test with no external dependencies
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain models under test - NOT mocked!
const {
  ConversationRepository,
} = require('../../../../src/domain/conversation/ConversationRepository');
const { Conversation } = require('../../../../src/domain/conversation/Conversation');
const { ConversationId } = require('../../../../src/domain/conversation/ConversationId');
const { PersonalityId } = require('../../../../src/domain/personality/PersonalityId');
const { Message } = require('../../../../src/domain/conversation/Message');

describe('ConversationRepository', () => {
  let repository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new ConversationRepository();
  });

  describe('interface methods', () => {
    it('should define save method', () => {
      expect(repository.save).toBeDefined();
      expect(typeof repository.save).toBe('function');
    });

    it('should define findById method', () => {
      expect(repository.findById).toBeDefined();
      expect(typeof repository.findById).toBe('function');
    });

    it('should define findActiveByUser method', () => {
      expect(repository.findActiveByUser).toBeDefined();
      expect(typeof repository.findActiveByUser).toBe('function');
    });

    it('should define findByMessageId method', () => {
      expect(repository.findByMessageId).toBeDefined();
      expect(typeof repository.findByMessageId).toBe('function');
    });

    it('should define findByPersonality method', () => {
      expect(repository.findByPersonality).toBeDefined();
      expect(typeof repository.findByPersonality).toBe('function');
    });

    it('should define delete method', () => {
      expect(repository.delete).toBeDefined();
      expect(typeof repository.delete).toBe('function');
    });

    it('should define cleanupExpired method', () => {
      expect(repository.cleanupExpired).toBeDefined();
      expect(typeof repository.cleanupExpired).toBe('function');
    });
  });

  describe('unimplemented methods', () => {
    it('should throw error for save', async () => {
      const conversationId = new ConversationId('123456789012345678', '987654321098765432');
      const conversation = new Conversation(conversationId);

      await expect(repository.save(conversation)).rejects.toThrow(
        'ConversationRepository.save() must be implemented'
      );
    });

    it('should throw error for findById', async () => {
      const id = new ConversationId('123456789012345678', '987654321098765432');

      await expect(repository.findById(id)).rejects.toThrow(
        'ConversationRepository.findById() must be implemented'
      );
    });

    it('should throw error for findActiveByUser', async () => {
      await expect(repository.findActiveByUser('123456789012345678')).rejects.toThrow(
        'ConversationRepository.findActiveByUser() must be implemented'
      );
    });

    it('should throw error for findByMessageId', async () => {
      await expect(repository.findByMessageId('987654321098765432')).rejects.toThrow(
        'ConversationRepository.findByMessageId() must be implemented'
      );
    });

    it('should throw error for findByPersonality', async () => {
      const personalityId = new PersonalityId('test-personality');

      await expect(repository.findByPersonality(personalityId)).rejects.toThrow(
        'ConversationRepository.findByPersonality() must be implemented'
      );
    });

    it('should throw error for delete', async () => {
      const id = new ConversationId('123456789012345678', '987654321098765432');

      await expect(repository.delete(id)).rejects.toThrow(
        'ConversationRepository.delete() must be implemented'
      );
    });

    it('should throw error for cleanupExpired', async () => {
      const expiryDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      await expect(repository.cleanupExpired(expiryDate)).rejects.toThrow(
        'ConversationRepository.cleanupExpired() must be implemented'
      );
    });
  });

  describe('mock implementation', () => {
    class MockConversationRepository extends ConversationRepository {
      constructor() {
        super();
        this.conversations = new Map();
        this.messageIndex = new Map(); // messageId -> conversationId
      }

      async save(conversation) {
        this.conversations.set(conversation.id, conversation);

        // Update message index
        conversation.messages.forEach(message => {
          this.messageIndex.set(message.id, conversation.id);
        });
      }

      async findById(conversationId) {
        return this.conversations.get(conversationId.toString()) || null;
      }

      async findActiveByUser(userId) {
        return Array.from(this.conversations.values()).filter(
          c => !c.ended && c.messages.some(m => m.authorId === userId)
        );
      }

      async findByMessageId(messageId) {
        const conversationId = this.messageIndex.get(messageId);
        if (!conversationId) return null;
        return this.conversations.get(conversationId) || null;
      }

      async findByPersonality(personalityId) {
        return Array.from(this.conversations.values()).filter(
          c => c.activePersonalityId && c.activePersonalityId.equals(personalityId)
        );
      }

      async delete(conversationId) {
        const conversation = this.conversations.get(conversationId.toString());
        if (conversation) {
          // Remove from message index
          conversation.messages.forEach(message => {
            this.messageIndex.delete(message.id);
          });
        }
        this.conversations.delete(conversationId.toString());
      }

      async cleanupExpired(expiryDate) {
        let deletedCount = 0;
        const conversationsToDelete = [];

        for (const [id, conversation] of this.conversations) {
          if (conversation.endedAt && new Date(conversation.endedAt) < expiryDate) {
            conversationsToDelete.push(id);
          }
        }

        for (const id of conversationsToDelete) {
          await this.delete(ConversationId.fromString(id));
          deletedCount++;
        }

        return deletedCount;
      }
    }

    it('should allow implementation of interface', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      const mockRepo = new MockConversationRepository();
      const conversationId = new ConversationId('123456789012345678', '987654321098765432');
      const personalityId = new PersonalityId('test-personality');

      const initialMessage = new Message({
        id: 'msg-initial',
        content: 'Hello',
        authorId: '123456789012345678',
        timestamp: new Date(),
        isFromPersonality: false,
        channelId: 'test-channel-123',
      });

      const conversation = Conversation.start(conversationId, initialMessage, personalityId);

      // Add another message
      const secondMessage = new Message({
        id: 'msg-1',
        content: 'Hello again',
        authorId: '123456789012345678',
        timestamp: new Date(),
        isFromPersonality: false,
        channelId: 'test-channel-123',
      });
      conversation.addMessage(secondMessage);

      // Test save
      await mockRepo.save(conversation);

      // Test findById
      const found = await mockRepo.findById(conversationId);
      expect(found).toBe(conversation);

      // Test findActiveByUser
      const byUser = await mockRepo.findActiveByUser('123456789012345678');
      expect(byUser).toContain(conversation);

      // Test findByMessageId
      const byMessage = await mockRepo.findByMessageId('msg-1');
      expect(byMessage).toBe(conversation);

      // Test findByPersonality
      const byPersonality = await mockRepo.findByPersonality(personalityId);
      expect(byPersonality).toContain(conversation);

      // Test cleanupExpired
      conversation.end();
      await mockRepo.save(conversation);

      jest.advanceTimersByTime(8 * 24 * 60 * 60 * 1000); // 8 days
      const expiryDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const deleted = await mockRepo.cleanupExpired(expiryDate);
      expect(deleted).toBe(1);

      const afterCleanup = await mockRepo.findById(conversationId);
      expect(afterCleanup).toBeNull();

      jest.useRealTimers();
    });
  });

  describe('interface contract', () => {
    it('should be extendable', () => {
      class CustomRepo extends ConversationRepository {}
      const customRepo = new CustomRepo();

      expect(customRepo).toBeInstanceOf(ConversationRepository);
    });

    it('should maintain method signatures', () => {
      // save(conversation) -> Promise<void>
      expect(repository.save.length).toBe(1);

      // findById(conversationId) -> Promise<Conversation|null>
      expect(repository.findById.length).toBe(1);

      // findActiveByUser(userId) -> Promise<Conversation[]>
      expect(repository.findActiveByUser.length).toBe(1);

      // findByMessageId(messageId) -> Promise<Conversation|null>
      expect(repository.findByMessageId.length).toBe(1);

      // findByPersonality(personalityId) -> Promise<Conversation[]>
      expect(repository.findByPersonality.length).toBe(1);

      // delete(conversationId) -> Promise<void>
      expect(repository.delete.length).toBe(1);

      // cleanupExpired(expiryDate) -> Promise<number>
      expect(repository.cleanupExpired.length).toBe(1);
    });
  });
});
