/**
 * @jest-environment node
 * @testType adapter
 *
 * MemoryConversationRepository Test
 * - Tests in-memory conversation repository adapter
 * - Domain models are NOT mocked
 */

jest.mock('../../../../src/logger');

const {
  MemoryConversationRepository,
} = require('../../../../src/adapters/persistence/MemoryConversationRepository');
const { Conversation, ConversationId, Message } = require('../../../../src/domain/conversation');
const { PersonalityId } = require('../../../../src/domain/personality');

describe('MemoryConversationRepository', () => {
  let repository;
  let testConversation;
  let testPersonalityId;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    repository = new MemoryConversationRepository({
      maxConversations: 10,
      ttlMs: 60 * 60 * 1000, // 1 hour
    });

    // Create test data
    testPersonalityId = new PersonalityId('test-personality');
    const conversationId = new ConversationId('user-456', 'channel-123');

    // Create initial message
    const initialMessage = new Message({
      id: 'msg-1',
      authorId: 'user-456',
      content: 'Hello world',
      timestamp: new Date(),
      channelId: 'channel-123',
      guildId: 'guild-789',
    });

    testConversation = Conversation.start(conversationId, initialMessage, testPersonalityId);

    // Add another message
    const message2 = new Message({
      id: 'msg-2',
      authorId: testPersonalityId.toString(),
      personalityId: testPersonalityId.toString(),
      content: 'Hello! How can I help?',
      timestamp: new Date(),
      channelId: 'channel-123',
      guildId: 'guild-789',
      isFromPersonality: true,
    });

    testConversation.addMessage(message2);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('save', () => {
    it('should save a conversation', async () => {
      await repository.save(testConversation);

      expect(repository._conversations.size).toBe(1);
      expect(repository._conversations.has(testConversation.id.toString())).toBe(true);
    });

    it('should update indexes when saving', async () => {
      await repository.save(testConversation);

      // Check message index
      expect(repository._messageIndex.get('msg-1')).toBe(testConversation.id.toString());
      expect(repository._messageIndex.get('msg-2')).toBe(testConversation.id.toString());

      // Check user index
      expect(repository._userIndex.has('user-456')).toBe(true);
      expect(repository._userIndex.get('user-456').has(testConversation.id.toString())).toBe(true);

      // Check personality index
      expect(repository._personalityIndex.has(testPersonalityId.toString())).toBe(true);
      expect(
        repository._personalityIndex
          .get(testPersonalityId.toString())
          .has(testConversation.id.toString())
      ).toBe(true);
    });

    it('should update last access time', async () => {
      const beforeSave = Date.now();
      await repository.save(testConversation);

      const lastAccess = repository._lastAccess.get(testConversation.id.toString());
      expect(lastAccess).toBeGreaterThanOrEqual(beforeSave);
    });

    it('should enforce maximum conversation limit', async () => {
      // Save 10 conversations (the limit)
      for (let i = 0; i < 10; i++) {
        const id = new ConversationId(`user-${i}`, `channel-${i}`);
        const msg = new Message({
          id: `init-msg-${i}`,
          authorId: `user-${i}`,
          content: `Initial message ${i}`,
          timestamp: new Date(),
          channelId: `channel-${i}`,
          guildId: 'guild-789',
        });
        const conversation = Conversation.start(id, msg, testPersonalityId);
        await repository.save(conversation);

        // Simulate different access times
        jest.advanceTimersByTime(1000);
      }

      expect(repository._conversations.size).toBe(10);

      // Save one more conversation
      const newId = new ConversationId('user-new', 'channel-new');
      const newMsg = new Message({
        id: 'init-msg-new',
        authorId: 'user-new',
        content: 'New conversation',
        timestamp: new Date(),
        channelId: 'channel-new',
        guildId: 'guild-789',
      });
      const newConversation = Conversation.start(newId, newMsg, testPersonalityId);
      await repository.save(newConversation);

      // Should still have 10 conversations (oldest was deleted)
      expect(repository._conversations.size).toBe(10);
      expect(repository._conversations.has('user-0:channel-0')).toBe(false);
      expect(repository._conversations.has(newId.toString())).toBe(true);
    });

    it('should handle save errors', async () => {
      // Force an error by making the conversation invalid
      repository._conversations = null;

      await expect(repository.save(testConversation)).rejects.toThrow(
        'Failed to save conversation'
      );
    });
  });

  describe('findById', () => {
    beforeEach(async () => {
      await repository.save(testConversation);
    });

    it('should find conversation by ID', async () => {
      const found = await repository.findById(testConversation.id);

      expect(found).toBeTruthy();
      expect(found.id.toString()).toBe(testConversation.id.toString());
      expect(found.messages).toHaveLength(2);
    });

    it('should update last access time when found', async () => {
      const originalAccess = repository._lastAccess.get(testConversation.id.toString());

      jest.advanceTimersByTime(5000);
      await repository.findById(testConversation.id);

      const newAccess = repository._lastAccess.get(testConversation.id.toString());
      expect(newAccess).toBeGreaterThan(originalAccess);
    });

    it('should return null if not found', async () => {
      const notFoundId = new ConversationId('user-999', 'not-found');
      const result = await repository.findById(notFoundId);

      expect(result).toBeNull();
    });

    it('should handle errors', async () => {
      repository._conversations = null;

      await expect(repository.findById(testConversation.id)).rejects.toThrow(
        'Failed to find conversation'
      );
    });
  });

  describe('findActiveByUser', () => {
    beforeEach(async () => {
      // Save multiple conversations for the same user
      await repository.save(testConversation);

      // Active conversation
      const activeId = new ConversationId('user-456', 'channel-active');
      const activeMsg = new Message({
        id: 'active-msg',
        authorId: 'user-456',
        content: 'Active conversation',
        timestamp: new Date(),
        channelId: 'channel-active',
        guildId: 'guild-789',
      });
      const activeConv = Conversation.start(activeId, activeMsg, testPersonalityId);
      await repository.save(activeConv);

      // Ended conversation
      const endedId = new ConversationId('user-456', 'channel-ended');
      const endedMsg = new Message({
        id: 'ended-msg',
        authorId: 'user-456',
        content: 'Ended conversation',
        timestamp: new Date(),
        channelId: 'channel-ended',
        guildId: 'guild-789',
      });
      const endedConv = Conversation.start(endedId, endedMsg, testPersonalityId);
      endedConv.end();
      await repository.save(endedConv);
    });

    it('should find active conversations for user', async () => {
      const conversations = await repository.findActiveByUser('user-456');

      expect(conversations).toHaveLength(2); // Original and active, not ended
      expect(conversations.every(c => c.conversationId.userId === 'user-456')).toBe(true);
      expect(conversations.every(c => !c.ended)).toBe(true);
    });

    it('should exclude conversations past TTL', async () => {
      // Advance time past TTL
      jest.advanceTimersByTime(2 * 60 * 60 * 1000); // 2 hours

      const conversations = await repository.findActiveByUser('user-456');
      expect(conversations).toHaveLength(0);
    });

    it('should return empty array for unknown user', async () => {
      const conversations = await repository.findActiveByUser('unknown-user');
      expect(conversations).toEqual([]);
    });

    it('should handle errors', async () => {
      repository._userIndex = null;

      await expect(repository.findActiveByUser('user-456')).rejects.toThrow(
        'Failed to find conversations by user'
      );
    });
  });

  describe('findByMessageId', () => {
    beforeEach(async () => {
      await repository.save(testConversation);
    });

    it('should find conversation by message ID', async () => {
      const found = await repository.findByMessageId('msg-1');

      expect(found).toBeTruthy();
      expect(found.id.toString()).toBe(testConversation.id.toString());
      expect(found.messages.some(m => m.id === 'msg-1')).toBe(true);
    });

    it('should update last access time when found', async () => {
      const originalAccess = repository._lastAccess.get(testConversation.id.toString());

      jest.advanceTimersByTime(5000);
      await repository.findByMessageId('msg-2');

      const newAccess = repository._lastAccess.get(testConversation.id.toString());
      expect(newAccess).toBeGreaterThan(originalAccess);
    });

    it('should return null if message not found', async () => {
      const result = await repository.findByMessageId('unknown-msg');
      expect(result).toBeNull();
    });

    it('should return null if conversation deleted', async () => {
      repository._conversations.delete(testConversation.id.toString());

      const result = await repository.findByMessageId('msg-1');
      expect(result).toBeNull();
    });

    it('should handle errors', async () => {
      repository._messageIndex = null;

      await expect(repository.findByMessageId('msg-1')).rejects.toThrow(
        'Failed to find conversation by message'
      );
    });
  });

  describe('findByPersonality', () => {
    beforeEach(async () => {
      // Save multiple conversations with same personality
      await repository.save(testConversation);

      const id2 = new ConversationId('user-789', 'channel-2');
      const msg2 = new Message({
        id: 'conv2-msg',
        authorId: 'user-789',
        content: 'Second conversation',
        timestamp: new Date(),
        channelId: 'channel-2',
        guildId: 'guild-789',
      });
      const conv2 = Conversation.start(id2, msg2, testPersonalityId);
      await repository.save(conv2);

      // Different personality
      const otherId = new PersonalityId('other-personality');
      const id3 = new ConversationId('user-999', 'channel-3');
      const msg3 = new Message({
        id: 'conv3-msg',
        authorId: 'user-999',
        content: 'Third conversation',
        timestamp: new Date(),
        channelId: 'channel-3',
        guildId: 'guild-789',
      });
      const conv3 = Conversation.start(id3, msg3, otherId);
      await repository.save(conv3);
    });

    it('should find all conversations with personality', async () => {
      const conversations = await repository.findByPersonality(testPersonalityId);

      expect(conversations).toHaveLength(2);
      expect(
        conversations.every(c => c.activePersonalityId?.toString() === testPersonalityId.toString())
      ).toBe(true);
    });

    it('should return empty array for unknown personality', async () => {
      const unknownId = new PersonalityId('unknown-personality');
      const conversations = await repository.findByPersonality(unknownId);

      expect(conversations).toEqual([]);
    });

    it('should handle errors', async () => {
      repository._personalityIndex = null;

      await expect(repository.findByPersonality(testPersonalityId)).rejects.toThrow(
        'Failed to find conversations by personality'
      );
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await repository.save(testConversation);
    });

    it('should delete conversation and all indexes', async () => {
      await repository.delete(testConversation.id);

      expect(repository._conversations.has(testConversation.id.toString())).toBe(false);
      expect(repository._lastAccess.has(testConversation.id.toString())).toBe(false);
      expect(repository._messageIndex.has('msg-1')).toBe(false);
      expect(repository._messageIndex.has('msg-2')).toBe(false);

      const userConvs = repository._userIndex.get('user-456');
      expect(userConvs).toBeUndefined();

      const personalityConvs = repository._personalityIndex.get(testPersonalityId.toString());
      expect(personalityConvs).toBeUndefined();
    });

    it('should handle deleting non-existent conversation', async () => {
      const notFoundId = new ConversationId('user-999', 'not-found');

      // Should not throw
      await expect(repository.delete(notFoundId)).resolves.not.toThrow();
    });

    it('should handle errors', async () => {
      repository._conversations = null;

      await expect(repository.delete(testConversation.id)).rejects.toThrow(
        'Failed to delete conversation'
      );
    });
  });

  describe('cleanupExpired', () => {
    beforeEach(async () => {
      // Create conversations with different states
      await repository.save(testConversation);

      // Ended conversation
      const endedId = new ConversationId('user-ended', 'channel-ended');
      const endedMsg = new Message({
        id: 'ended-cleanup-msg',
        authorId: 'user-ended',
        content: 'Message for ended conversation',
        timestamp: new Date(),
        channelId: 'channel-ended',
        guildId: 'guild-789',
      });
      const endedConv = Conversation.start(endedId, endedMsg, testPersonalityId);
      endedConv.end();
      await repository.save(endedConv);

      // Old inactive conversation
      const oldId = new ConversationId('user-old', 'channel-old');
      const oldMsg = new Message({
        id: 'old-msg',
        authorId: 'user-old',
        content: 'Old conversation',
        timestamp: new Date(),
        channelId: 'channel-old',
        guildId: 'guild-789',
      });
      const oldConv = Conversation.start(oldId, oldMsg, testPersonalityId);
      await repository.save(oldConv);

      // Set proper last access times
      const now = Date.now();
      repository._lastAccess.set(testConversation.id.toString(), now); // Recent access
      repository._lastAccess.set(endedId.toString(), now); // Recent access for ended conv
      repository._lastAccess.set(oldId.toString(), now - 2 * 60 * 60 * 1000); // 2 hours ago
    });

    it('should cleanup ended conversations before expiry date', async () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour future
      const deletedCount = await repository.cleanupExpired(futureDate);

      expect(deletedCount).toBe(2); // Ended conversation + old conversation past TTL
      expect(repository._conversations.size).toBe(1); // Only testConversation remains
    });

    it('should cleanup conversations past TTL', async () => {
      const now = new Date();
      const deletedCount = await repository.cleanupExpired(now);

      expect(deletedCount).toBe(1); // The old inactive conversation
      expect(repository._conversations.has('user-old:channel-old')).toBe(false);
    });

    it('should handle errors', async () => {
      repository._conversations = null;

      await expect(repository.cleanupExpired(new Date())).rejects.toThrow(
        'Failed to cleanup expired conversations'
      );
    });
  });

  describe('getStats', () => {
    it('should return repository statistics', async () => {
      await repository.save(testConversation);

      const stats = repository.getStats();

      expect(stats).toEqual({
        totalConversations: 1,
        totalMessages: 2,
        totalUsers: 1,
        totalPersonalities: 1,
        memoryUsage: expect.any(Number),
      });
    });
  });

  describe('clear', () => {
    it('should clear all data', async () => {
      await repository.save(testConversation);
      await repository.clear();

      expect(repository._conversations.size).toBe(0);
      expect(repository._messageIndex.size).toBe(0);
      expect(repository._userIndex.size).toBe(0);
      expect(repository._personalityIndex.size).toBe(0);
      expect(repository._lastAccess.size).toBe(0);
    });
  });
});
