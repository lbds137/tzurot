/**
 * @jest-environment node
 * @testType adapter
 *
 * FileConversationRepository Test
 * - Tests file-based conversation repository adapter
 * - Mocks external dependencies (fs, logger)
 * - Domain models are NOT mocked
 */

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn(),
  },
}));
jest.mock('../../../../src/logger');

const { dddPresets } = require('../../../__mocks__/ddd');

const fs = require('fs').promises;
const path = require('path');
const {
  FileConversationRepository,
} = require('../../../../src/adapters/persistence/FileConversationRepository');
const {
  Conversation,
  ConversationId,
  Message,
  ConversationSettings,
} = require('../../../../src/domain/conversation');
const { PersonalityId } = require('../../../../src/domain/personality');

describe('FileConversationRepository', () => {
  let repository;
  let mockFileData;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Default mock file data
    mockFileData = {
      conversations: {
        '123456789012345678:987654321098765432': {
          id: '123456789012345678:987654321098765432',
          conversationId: {
            userId: '123456789012345678',
            channelId: '987654321098765432',
          },
          userId: '123456789012345678',
          channelId: '987654321098765432',
          personalityId: 'test-personality',
          messages: [
            {
              id: 'msg-1',
              content: 'Hello',
              authorId: '123456789012345678',
              timestamp: '2024-01-01T00:00:00.000Z',
              isFromPersonality: false,
            },
            {
              id: 'msg-2',
              content: 'Hi there!',
              authorId: 'bot-123',
              timestamp: '2024-01-01T00:00:01.000Z',
              isFromPersonality: true,
            },
          ],
          settings: {
            autoResponseEnabled: false,
            autoResponseDelay: 8000,
            mentionOnly: false,
            timeoutMs: 600000,
          },
          startedAt: new Date().toISOString(), // Use recent date to avoid cleanup
          updatedAt: new Date().toISOString(),
          savedAt: new Date().toISOString(),
        },
      },
      channelActivations: {},
    };

    // Mock fs methods
    fs.mkdir.mockResolvedValue();
    fs.readFile.mockResolvedValue(JSON.stringify(mockFileData));
    fs.writeFile.mockResolvedValue();
    fs.rename.mockResolvedValue();

    repository = new FileConversationRepository({
      dataPath: './test-data',
      filename: 'test-conversations.json',
      maxConversations: 100,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialize', () => {
    it('should create data directory if it does not exist', async () => {
      await repository.initialize();

      expect(fs.mkdir).toHaveBeenCalledWith('./test-data', { recursive: true });
    });

    it('should load existing data file', async () => {
      await repository.initialize();

      expect(fs.readFile).toHaveBeenCalledWith(
        path.join('./test-data', 'test-conversations.json'),
        'utf8'
      );
      // Check that cache was loaded (exact equality won't work due to cleanup)
      expect(repository._cache.conversations).toBeDefined();
      expect(Object.keys(repository._cache.conversations)).toHaveLength(1);
      expect(repository._initialized).toBe(true);
    });

    it('should create new file if it does not exist', async () => {
      fs.readFile.mockRejectedValue({ code: 'ENOENT' });

      await repository.initialize();

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join('./test-data', 'test-conversations.json.tmp'),
        JSON.stringify({ conversations: {}, channelActivations: {} }, null, 2),
        'utf8'
      );
      expect(fs.rename).toHaveBeenCalled();
      expect(repository._cache).toEqual({ conversations: {}, channelActivations: {} });
    });

    it('should clean up old conversations on startup', async () => {
      // Add an old conversation
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
      mockFileData.conversations['old-conv'] = {
        id: 'old-conv',
        savedAt: oldDate,
        startedAt: oldDate,
      };

      fs.readFile.mockResolvedValue(JSON.stringify(mockFileData));

      await repository.initialize();

      expect(repository._cache.conversations['old-conv']).toBeUndefined();
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should throw error for other file read errors', async () => {
      fs.readFile.mockRejectedValue(new Error('Permission denied'));

      await expect(repository.initialize()).rejects.toThrow(
        'Failed to initialize repository: Permission denied'
      );
    });

    it('should not reinitialize if already initialized', async () => {
      await repository.initialize();
      fs.readFile.mockClear();

      await repository.initialize();

      expect(fs.readFile).not.toHaveBeenCalled();
    });
  });

  describe('save', () => {
    it('should save a conversation with limited message history', async () => {
      await repository.initialize();

      const conversationId = new ConversationId('456789012345678901', '567890123456789012');
      const initialMessage = new Message({
        id: 'msg-new-1',
        content: 'New conversation',
        authorId: '456789012345678901',
        timestamp: new Date(),
        isFromPersonality: false,
        channelId: '567890123456789012',
      });

      const conversation = Conversation.start(
        conversationId,
        initialMessage,
        new PersonalityId('new-personality')
      );

      // Add many messages
      for (let i = 2; i <= 15; i++) {
        conversation.addMessage(
          new Message({
            id: `msg-new-${i}`,
            content: `Message ${i}`,
            authorId: i % 2 === 0 ? 'bot-123' : '456789012345678901',
            timestamp: new Date(),
            isFromPersonality: i % 2 === 0,
            channelId: '567890123456789012',
          })
        );
      }

      await repository.save(conversation);

      const savedData = repository._cache.conversations[conversationId.toString()];
      expect(savedData).toBeDefined();
      expect(savedData.messages).toHaveLength(10); // Only last 10 messages
      expect(savedData.messages[0].id).toBe('msg-new-6'); // First of last 10
      expect(savedData.messages[9].id).toBe('msg-new-15'); // Last message

      expect(fs.writeFile).toHaveBeenCalled();
      expect(fs.rename).toHaveBeenCalled();
    });

    it('should enforce max conversations limit', async () => {
      await repository.initialize();

      // Set a small limit for testing
      repository.maxConversations = 2;

      // Create 3 conversations
      for (let i = 1; i <= 3; i++) {
        const conversationId = new ConversationId(`user${i}`, `channel${i}`);
        const message = new Message({
          id: `msg-${i}`,
          content: `Message ${i}`,
          authorId: `user${i}`,
          timestamp: new Date(Date.now() + i * 1000), // Different timestamps
          isFromPersonality: false,
          channelId: `channel${i}`,
        });

        const conversation = Conversation.start(
          conversationId,
          message,
          new PersonalityId('test-personality')
        );

        await repository.save(conversation);
      }

      // Should only have 2 conversations (removed oldest)
      expect(Object.keys(repository._cache.conversations)).toHaveLength(2);
      expect(repository._cache.conversations['user1:channel1']).toBeUndefined();
      expect(repository._cache.conversations['user2:channel2']).toBeDefined();
      expect(repository._cache.conversations['user3:channel3']).toBeDefined();
    });

    it('should handle save errors', async () => {
      await repository.initialize();
      fs.writeFile.mockRejectedValue(new Error('Disk full'));

      const conversationId = new ConversationId('456789012345678901', '567890123456789012');
      const message = new Message({
        id: 'msg-1',
        content: 'Test',
        authorId: '456789012345678901',
        timestamp: new Date(),
        isFromPersonality: false,
        channelId: '567890123456789012',
      });

      const conversation = Conversation.start(
        conversationId,
        message,
        new PersonalityId('test-personality')
      );

      await expect(repository.save(conversation)).rejects.toThrow(
        'Failed to save conversation: Failed to persist data: Disk full'
      );
    });

    it('should initialize if not already initialized', async () => {
      const conversationId = new ConversationId('456789012345678901', '567890123456789012');
      const message = new Message({
        id: 'msg-1',
        content: 'Test',
        authorId: '456789012345678901',
        timestamp: new Date(),
        isFromPersonality: false,
        channelId: '567890123456789012',
      });

      const conversation = Conversation.start(
        conversationId,
        message,
        new PersonalityId('test-personality')
      );

      await repository.save(conversation);

      expect(fs.mkdir).toHaveBeenCalled();
      expect(repository._initialized).toBe(true);
    });
  });

  describe('findById', () => {
    it('should find conversation by ID', async () => {
      await repository.initialize();

      const conversationId = new ConversationId('123456789012345678', '987654321098765432');
      const result = await repository.findById(conversationId);

      expect(result).toBeInstanceOf(Conversation);
      expect(result.conversationId.toString()).toBe('123456789012345678:987654321098765432');
      // Conversation stores personalityId internally as activePersonalityId
      expect(result.activePersonalityId.value).toBe('test-personality');
      expect(result.messages).toHaveLength(2);
    });

    it('should return null if conversation not found', async () => {
      await repository.initialize();

      const conversationId = new ConversationId('999999999999999999', '888888888888888888');
      const result = await repository.findById(conversationId);

      expect(result).toBeNull();
    });

    it('should handle errors during hydration', async () => {
      await repository.initialize();
      repository._cache.conversations['bad-data'] = { invalid: 'data' };

      const conversationId = { toString: () => 'bad-data' };

      await expect(repository.findById(conversationId)).rejects.toThrow(
        'Failed to find conversation'
      );
    });
  });

  describe('findActiveByUser', () => {
    it('should find active conversations by user', async () => {
      await repository.initialize();

      // Add another active conversation for the same user
      const recentTime = new Date().toISOString();
      repository._cache.conversations['123456789012345678:111111111111111111'] = {
        ...mockFileData.conversations['123456789012345678:987654321098765432'],
        id: '123456789012345678:111111111111111111',
        channelId: '111111111111111111',
        updatedAt: recentTime,
        savedAt: recentTime,
      };

      const results = await repository.findActiveByUser('123456789012345678');

      expect(results).toHaveLength(2); // Both are recent now since we updated timestamps
      expect(results[0]).toBeInstanceOf(Conversation);
      expect(results.every(r => r.conversationId.userId === '123456789012345678')).toBe(true);
    });

    it('should not return ended conversations', async () => {
      await repository.initialize();

      // Mark conversation as ended
      repository._cache.conversations['123456789012345678:987654321098765432'].endedAt =
        new Date().toISOString();

      const results = await repository.findActiveByUser('123456789012345678');

      expect(results).toHaveLength(0);
    });

    it('should return empty array if no active conversations', async () => {
      await repository.initialize();

      const results = await repository.findActiveByUser('999999999999999999');

      expect(results).toEqual([]);
    });

    it('should handle errors during hydration', async () => {
      await repository.initialize();

      // Add bad data
      repository._cache.conversations['bad-conv'] = {
        userId: '123456789012345678',
        invalid: 'data',
        updatedAt: new Date().toISOString(),
      };

      await expect(repository.findActiveByUser('123456789012345678')).rejects.toThrow(
        'Failed to find active conversations'
      );
    });
  });

  describe('findActiveByChannel', () => {
    it('should find most recent active conversation in channel', async () => {
      await repository.initialize();

      const now = new Date();
      const channel = '987654321098765432';

      // Add multiple conversations in same channel
      repository._cache.conversations['user1:987654321098765432'] = {
        ...mockFileData.conversations['123456789012345678:987654321098765432'],
        id: 'user1:987654321098765432',
        userId: 'user1',
        updatedAt: new Date(now - 10 * 60 * 1000).toISOString(), // 10 min ago
      };

      repository._cache.conversations['user2:987654321098765432'] = {
        ...mockFileData.conversations['123456789012345678:987654321098765432'],
        id: 'user2:987654321098765432',
        userId: 'user2',
        updatedAt: new Date(now - 5 * 60 * 1000).toISOString(), // 5 min ago (most recent)
      };

      const result = await repository.findActiveByChannel(channel);

      expect(result).toBeInstanceOf(Conversation);
      // Should return the most recent conversation in the channel
      expect(result.conversationId.toString()).toContain(':987654321098765432');
    });

    it('should return null if no active conversation in channel', async () => {
      await repository.initialize();

      const result = await repository.findActiveByChannel('999999999999999999');

      expect(result).toBeNull();
    });

    it('should not return conversations older than threshold', async () => {
      // Create separate repository with old conversation data
      const oldDate = new Date(Date.now() - 31 * 60 * 1000).toISOString(); // 31 minutes ago
      const oldData = {
        conversations: {
          '123456789012345678:987654321098765432': {
            ...mockFileData.conversations['123456789012345678:987654321098765432'],
            updatedAt: oldDate,
            startedAt: oldDate,
            savedAt: oldDate,
          },
        },
        channelActivations: {},
      };

      fs.readFile.mockResolvedValueOnce(JSON.stringify(oldData));

      const oldRepository = new FileConversationRepository({
        dataPath: './test-data',
        filename: 'old-conversations.json',
      });

      await oldRepository.initialize();

      const result = await oldRepository.findActiveByChannel('987654321098765432');

      expect(result).toBeNull();
    });

    it('should handle errors during hydration', async () => {
      await repository.initialize();

      // Clear existing conversations to ensure bad one is the only one
      repository._cache.conversations = {};

      repository._cache.conversations['bad-conv'] = {
        channelId: '987654321098765432',
        updatedAt: new Date().toISOString(),
        // Missing required fields like userId, messages will cause hydration to fail
        messages: null, // This will cause an error when trying to access messages[0]
      };

      await expect(repository.findActiveByChannel('987654321098765432')).rejects.toThrow(
        'Failed to find active conversation'
      );
    });
  });

  describe('delete', () => {
    it('should delete a conversation', async () => {
      await repository.initialize();

      const conversationId = new ConversationId('123456789012345678', '987654321098765432');

      await repository.delete(conversationId);

      expect(
        repository._cache.conversations['123456789012345678:987654321098765432']
      ).toBeUndefined();
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should handle deleting non-existent conversation', async () => {
      await repository.initialize();

      const conversationId = new ConversationId('999999999999999999', '888888888888888888');

      await repository.delete(conversationId);

      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should handle delete errors', async () => {
      await repository.initialize();
      fs.writeFile.mockRejectedValue(new Error('Permission denied'));

      const conversationId = new ConversationId('123456789012345678', '987654321098765432');

      await expect(repository.delete(conversationId)).rejects.toThrow(
        'Failed to delete conversation'
      );
    });
  });

  describe('countByPersonality', () => {
    it('should count conversations for a personality', async () => {
      await repository.initialize();

      // Add more conversations for the same personality
      repository._cache.conversations['conv2'] = {
        ...mockFileData.conversations['123456789012345678:987654321098765432'],
        id: 'conv2',
        personalityId: 'test-personality',
      };

      repository._cache.conversations['conv3'] = {
        ...mockFileData.conversations['123456789012345678:987654321098765432'],
        id: 'conv3',
        personalityId: 'other-personality',
      };

      const count = await repository.countByPersonality(new PersonalityId('test-personality'));

      expect(count).toBe(2);
    });

    it('should return 0 if no conversations for personality', async () => {
      await repository.initialize();

      const count = await repository.countByPersonality(new PersonalityId('non-existent'));

      expect(count).toBe(0);
    });

    it('should handle errors', async () => {
      await repository.initialize();

      // Mock an error by making Object.values throw
      const originalValues = Object.values;
      Object.values = jest.fn().mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      await expect(repository.countByPersonality(new PersonalityId('test'))).rejects.toThrow(
        'Failed to count conversations'
      );

      Object.values = originalValues;
    });
  });

  describe('getStats', () => {
    it('should return repository statistics', async () => {
      await repository.initialize();

      // Add more conversations
      repository._cache.conversations['conv2'] = {
        id: 'conv2',
        personalityId: 'personality2',
        userId: 'user2',
        channelId: 'channel2',
        endedAt: null,
      };

      repository._cache.conversations['conv3'] = {
        id: 'conv3',
        personalityId: 'test-personality',
        userId: '123456789012345678',
        channelId: 'channel3',
        endedAt: new Date().toISOString(),
      };

      const stats = await repository.getStats();

      expect(stats).toEqual({
        totalConversations: 3,
        activeConversations: 2,
        uniquePersonalities: 2,
        uniqueUsers: 2,
        uniqueChannels: 3,
      });
    });

    it('should return zero stats for empty repository', async () => {
      fs.readFile.mockResolvedValue(JSON.stringify({ conversations: {}, channelActivations: {} }));

      await repository.initialize();

      const stats = await repository.getStats();

      expect(stats).toEqual({
        totalConversations: 0,
        activeConversations: 0,
        uniquePersonalities: 0,
        uniqueUsers: 0,
        uniqueChannels: 0,
      });
    });
  });

  describe('_hydrate', () => {
    it('should hydrate conversation with settings', async () => {
      await repository.initialize();

      const data = mockFileData.conversations['123456789012345678:987654321098765432'];
      const conversation = repository._hydrate(data);

      expect(conversation).toBeInstanceOf(Conversation);
      // ConversationSettings doesn't have maxMessages or contextWindow
      // Check the actual properties
      expect(conversation.settings).toBeInstanceOf(ConversationSettings);
      expect(conversation.settings.autoResponseEnabled).toBe(false);
      expect(conversation.settings.timeoutMs).toBe(600000);
    });

    it('should hydrate ended conversation', async () => {
      await repository.initialize();

      const data = {
        ...mockFileData.conversations['123456789012345678:987654321098765432'],
        endedAt: '2024-01-01T00:10:00.000Z',
        endedReason: 'user_request',
      };

      const conversation = repository._hydrate(data);

      expect(conversation.ended).toBe(true);
      expect(conversation.endedAt).not.toBeNull();
    });

    it('should mark events as committed', async () => {
      await repository.initialize();

      const data = mockFileData.conversations['123456789012345678:987654321098765432'];
      const conversation = repository._hydrate(data);

      expect(conversation.getUncommittedEvents()).toHaveLength(0);
    });
  });

  describe('_persist', () => {
    it('should write to temp file then rename', async () => {
      await repository.initialize();
      repository._cache.conversations['new'] = { id: 'new' };

      await repository._persist();

      const expectedPath = path.join('./test-data', 'test-conversations.json');
      const tempPath = expectedPath + '.tmp';

      expect(fs.writeFile).toHaveBeenCalledWith(tempPath, expect.any(String), 'utf8');
      expect(fs.rename).toHaveBeenCalledWith(tempPath, expectedPath);
    });

    it('should format JSON with indentation', async () => {
      await repository.initialize();

      await repository._persist();

      const writtenData = fs.writeFile.mock.calls[0][1];
      expect(writtenData).toContain('  '); // Check for indentation
      expect(() => JSON.parse(writtenData)).not.toThrow();
    });

    it('should throw specific error on failure', async () => {
      await repository.initialize();
      fs.writeFile.mockRejectedValue(new Error('EACCES'));

      await expect(repository._persist()).rejects.toThrow('Failed to persist data: EACCES');
    });
  });

  describe('_cleanupOldConversations', () => {
    it('should remove conversations older than 24 hours', async () => {
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

      mockFileData.conversations['old-conv'] = {
        id: 'old-conv',
        savedAt: oldDate,
        startedAt: oldDate,
      };

      mockFileData.conversations['recent-conv'] = {
        id: 'recent-conv',
        savedAt: recentDate,
        startedAt: recentDate,
      };

      fs.readFile.mockResolvedValue(JSON.stringify(mockFileData));

      await repository.initialize();

      expect(repository._cache.conversations['old-conv']).toBeUndefined();
      expect(repository._cache.conversations['recent-conv']).toBeDefined();
    });

    it('should remove ended conversations regardless of age', async () => {
      const recentDate = new Date().toISOString();

      mockFileData.conversations['ended-conv'] = {
        id: 'ended-conv',
        savedAt: recentDate,
        startedAt: recentDate,
        endedAt: recentDate,
      };

      fs.readFile.mockResolvedValue(JSON.stringify(mockFileData));

      await repository.initialize();

      expect(repository._cache.conversations['ended-conv']).toBeUndefined();
    });
  });

  describe('_enforceMaxConversations', () => {
    it('should remove oldest conversations when limit exceeded', async () => {
      await repository.initialize();
      repository.maxConversations = 2;

      const now = Date.now();
      repository._cache.conversations = {
        conv1: {
          id: 'conv1',
          updatedAt: new Date(now - 3000).toISOString(),
          startedAt: new Date(now - 3000).toISOString(),
        },
        conv2: {
          id: 'conv2',
          updatedAt: new Date(now - 2000).toISOString(),
          startedAt: new Date(now - 2000).toISOString(),
        },
        conv3: {
          id: 'conv3',
          updatedAt: new Date(now - 1000).toISOString(),
          startedAt: new Date(now - 1000).toISOString(),
        },
      };

      await repository._enforceMaxConversations();

      expect(Object.keys(repository._cache.conversations)).toHaveLength(2);
      expect(repository._cache.conversations['conv1']).toBeUndefined();
      expect(repository._cache.conversations['conv2']).toBeDefined();
      expect(repository._cache.conversations['conv3']).toBeDefined();
    });
  });
});
