/**
 * Tests for PersonalityDataService
 */

// Mock dependencies before imports
jest.mock('../../../src/logger');
jest.mock('../../../src/domain/personality/PersonalityDataRepository');
jest.mock('../../../src/domain/personality/PersonalityProfile');

const { PersonalityDataService, getPersonalityDataService } = require('../../../src/services/PersonalityDataService');
const { PersonalityDataRepository } = require('../../../src/domain/personality/PersonalityDataRepository');
const logger = require('../../../src/logger');

describe('PersonalityDataService', () => {
  let service;
  let mockRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock repository
    mockRepository = {
      getExtendedProfile: jest.fn(),
      hasExtendedData: jest.fn(),
      getChatHistory: jest.fn(),
      getMemories: jest.fn(),
      getKnowledge: jest.fn(),
    };
    
    // Mock the repository constructor
    PersonalityDataRepository.mockImplementation(() => mockRepository);
    
    // Create service instance
    service = new PersonalityDataService();
  });

  describe('constructor', () => {
    it('should create instance with default repository', () => {
      const service = new PersonalityDataService();
      expect(PersonalityDataRepository).toHaveBeenCalled();
      expect(service.repository).toBe(mockRepository);
      expect(service.contextCache).toBeInstanceOf(Map);
    });

    it('should accept custom repository', () => {
      const customRepo = { custom: true };
      const service = new PersonalityDataService(customRepo);
      expect(service.repository).toBe(customRepo);
    });
  });

  describe('getEnhancedProfile', () => {
    it('should return extended profile when available', async () => {
      const extendedProfile = { name: 'test', extended: true };
      mockRepository.getExtendedProfile.mockResolvedValue(extendedProfile);

      const result = await service.getEnhancedProfile('test-personality');

      expect(mockRepository.getExtendedProfile).toHaveBeenCalledWith('test-personality');
      expect(result).toBe(extendedProfile);
      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityDataService] Using extended profile for test-personality'
      );
    });

    it('should return basic profile when no extended data exists', async () => {
      const basicProfile = { name: 'test', basic: true };
      mockRepository.getExtendedProfile.mockResolvedValue(null);

      const result = await service.getEnhancedProfile('test-personality', basicProfile);

      expect(result).toBe(basicProfile);
    });

    it('should handle repository errors gracefully', async () => {
      const basicProfile = { name: 'test' };
      mockRepository.getExtendedProfile.mockRejectedValue(new Error('DB Error'));

      const result = await service.getEnhancedProfile('test-personality', basicProfile);

      expect(result).toBe(basicProfile);
      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityDataService] Error getting enhanced profile: DB Error'
      );
    });
  });

  describe('hasBackupData', () => {
    it('should check if personality has extended data', async () => {
      mockRepository.hasExtendedData.mockResolvedValue(true);

      const result = await service.hasBackupData('test-personality');

      expect(result).toBe(true);
      expect(mockRepository.hasExtendedData).toHaveBeenCalledWith('test-personality');
    });
  });

  describe('getConversationContext', () => {
    it('should get full context with default options', async () => {
      const mockHistory = [
        { message: 'Hello', ts: 1234567890 },
        { reply: 'Hi there', ts: 1234567891, voice_reply_url: 'audio.mp3' },
      ];
      const mockMemories = [
        { content: 'Memory 1' },
        { content: 'Memory 2' },
        { content: 'Memory 3' },
        { content: 'Memory 4' },
        { content: 'Memory 5' },
        { content: 'Memory 6' }, // Should be excluded (limit 5)
      ];
      const mockKnowledge = [
        { content: 'Fact 1' },
        { content: 'Fact 2' },
        { content: 'Fact 3' },
        { content: 'Fact 4' }, // Should be excluded (limit 3)
      ];

      mockRepository.getChatHistory.mockResolvedValue(mockHistory);
      mockRepository.getMemories.mockResolvedValue(mockMemories);
      mockRepository.getKnowledge.mockResolvedValue(mockKnowledge);
      mockRepository.hasExtendedData.mockResolvedValue(true);

      const result = await service.getConversationContext('test-personality', 'user123');

      expect(result).toEqual({
        history: [
          {
            role: 'user',
            content: 'Hello',
            timestamp: 1234567890,
            metadata: {
              hasVoice: false,
              hasAttachment: false,
              attachmentType: undefined,
            },
          },
          {
            role: 'assistant',
            content: 'Hi there',
            timestamp: 1234567891,
            metadata: {
              hasVoice: true,
              hasAttachment: false,
              attachmentType: undefined,
            },
          },
        ],
        memories: mockMemories.slice(0, 5),
        knowledge: mockKnowledge.slice(0, 3),
        metadata: {
          hasExtendedData: true,
          contextSources: {
            history: true,
            memories: true,
            knowledge: true,
          },
        },
      });
    });

    it('should respect custom options', async () => {
      const options = {
        includeHistory: false,
        includeMemories: false,
        includeKnowledge: false,
      };

      mockRepository.hasExtendedData.mockResolvedValue(false);

      const result = await service.getConversationContext('test-personality', 'user123', options);

      expect(mockRepository.getChatHistory).not.toHaveBeenCalled();
      expect(mockRepository.getMemories).not.toHaveBeenCalled();
      expect(mockRepository.getKnowledge).not.toHaveBeenCalled();
      
      expect(result).toEqual({
        history: [],
        memories: [],
        knowledge: [],
        metadata: {
          hasExtendedData: false,
          contextSources: {
            history: false,
            memories: false,
            knowledge: false,
          },
        },
      });
    });

    it('should handle errors gracefully', async () => {
      mockRepository.getChatHistory.mockRejectedValue(new Error('DB Error'));

      const result = await service.getConversationContext('test-personality', 'user123');

      expect(result).toEqual({
        history: [],
        memories: [],
        knowledge: [],
        metadata: {},
      });
      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityDataService] Error getting conversation context: DB Error'
      );
    });

    it('should respect history limit option', async () => {
      const mockHistory = Array(20).fill({ message: 'test' });
      mockRepository.getChatHistory.mockResolvedValue(mockHistory);
      mockRepository.getMemories.mockResolvedValue([]);
      mockRepository.getKnowledge.mockResolvedValue([]);

      await service.getConversationContext('test-personality', 'user123', {
        historyLimit: 5,
      });

      expect(mockRepository.getChatHistory).toHaveBeenCalledWith('test-personality', {
        userId: 'user123',
        limit: 5,
      });
    });
  });

  describe('buildContextualPrompt', () => {
    const mockProfile = {
      prompt: 'Basic prompt',
    };

    beforeEach(() => {
      mockRepository.getChatHistory.mockResolvedValue([]);
      mockRepository.getMemories.mockResolvedValue([]);
      mockRepository.getKnowledge.mockResolvedValue([]);
      mockRepository.hasExtendedData.mockResolvedValue(false);
      mockRepository.getExtendedProfile.mockResolvedValue(null);
    });

    it('should build prompt with extended profile', async () => {
      const extendedProfile = {
        userPrompt: 'Extended user prompt',
        jailbreakPrompt: 'Jailbreak instructions',
      };
      mockRepository.getExtendedProfile.mockResolvedValue(extendedProfile);

      const result = await service.buildContextualPrompt(
        'test-personality',
        'user123',
        'Hello',
        mockProfile
      );

      expect(result.messages[0]).toEqual({
        role: 'system',
        content: 'Extended user prompt\n\nJailbreak instructions',
      });
      expect(result.messages[1]).toEqual({
        role: 'user',
        content: 'Hello',
      });
      expect(result.hasExtendedContext).toBe(false);
    });

    it('should use basic profile when no extended profile exists', async () => {
      const result = await service.buildContextualPrompt(
        'test-personality',
        'user123',
        'Hello',
        mockProfile
      );

      expect(result.messages[0]).toEqual({
        role: 'system',
        content: 'Basic prompt',
      });
    });

    it('should include knowledge context', async () => {
      mockRepository.getKnowledge.mockResolvedValue([
        { content: 'Fact 1' },
        { text: 'Fact 2' },
        { other: 'data' },
      ]);

      const result = await service.buildContextualPrompt(
        'test-personality',
        'user123',
        'Hello',
        mockProfile
      );

      expect(result.messages[0].content).toContain('## Background Knowledge');
      expect(result.messages[0].content).toContain('1. Fact 1');
      expect(result.messages[0].content).toContain('2. Fact 2');
      expect(result.messages[0].content).toContain('3. {"other":"data"}');
    });

    it('should include memory context with timestamps', async () => {
      mockRepository.getMemories.mockResolvedValue([
        { content: 'Memory 1', created_at: 1234567890 },
        { text: 'Memory 2' },
      ]);

      const result = await service.buildContextualPrompt(
        'test-personality',
        'user123',
        'Hello',
        mockProfile
      );

      expect(result.messages[0].content).toContain('## Relevant Memories');
      expect(result.messages[0].content).toContain('[2009-02-13T23:31:30.000Z] Memory 1');
      expect(result.messages[0].content).toContain('[Unknown] Memory 2');
    });

    it('should include conversation history in chronological order', async () => {
      mockRepository.getChatHistory.mockResolvedValue([
        { message: 'Latest message' },
        { reply: 'Latest reply' },
        { message: 'Older message' },
      ]);

      const result = await service.buildContextualPrompt(
        'test-personality',
        'user123',
        'Current message',
        mockProfile
      );

      // History should be reversed (oldest first)
      expect(result.messages[1]).toEqual({ role: 'user', content: 'Older message' });
      expect(result.messages[2]).toEqual({ role: 'assistant', content: 'Latest reply' });
      expect(result.messages[3]).toEqual({ role: 'user', content: 'Latest message' });
      expect(result.messages[4]).toEqual({ role: 'user', content: 'Current message' });
    });

    it('should handle array userMessage', async () => {
      const arrayMessage = ['text', { type: 'image', url: 'test.jpg' }];

      const result = await service.buildContextualPrompt(
        'test-personality',
        'user123',
        arrayMessage,
        mockProfile
      );

      expect(result.messages[result.messages.length - 1]).toEqual({
        role: 'user',
        content: arrayMessage,
      });
    });

    it('should handle object userMessage', async () => {
      const objectMessage = { type: 'complex', data: 'test' };

      const result = await service.buildContextualPrompt(
        'test-personality',
        'user123',
        objectMessage,
        mockProfile
      );

      expect(result.messages[result.messages.length - 1]).toEqual({
        role: 'user',
        content: objectMessage,
      });
    });
  });

  describe('addToConversationHistory', () => {
    it('should add message to context cache', async () => {
      const message = {
        role: 'user',
        content: 'Test message',
      };

      await service.addToConversationHistory('test-personality', 'user123', message);

      const cacheKey = 'test-personality:user123';
      expect(service.contextCache.has(cacheKey)).toBe(true);
      
      const history = service.contextCache.get(cacheKey);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        ...message,
        ts: expect.any(Number),
      });
    });

    it('should maintain maximum of 50 messages', async () => {
      const cacheKey = 'test-personality:user123';
      
      // Pre-fill with 50 messages (create individual objects)
      const oldMessages = Array(50).fill(null).map((_, i) => ({ content: `old-${i}` }));
      service.contextCache.set(cacheKey, oldMessages);

      // Add new message
      await service.addToConversationHistory('test-personality', 'user123', {
        content: 'new message',
      });

      const history = service.contextCache.get(cacheKey);
      expect(history).toHaveLength(50);
      expect(history[49].content).toBe('new message');
      expect(history[0].content).toBe('old-1'); // First message (old-0) should be shifted out
    });
  });

  describe('clearContextCache', () => {
    beforeEach(() => {
      // Add some test data to cache
      service.contextCache.set('personality1:user1', ['history1']);
      service.contextCache.set('personality1:user2', ['history2']);
      service.contextCache.set('personality2:user1', ['history3']);
    });

    it('should clear cache for specific personality', () => {
      service.clearContextCache('personality1');

      expect(service.contextCache.has('personality1:user1')).toBe(false);
      expect(service.contextCache.has('personality1:user2')).toBe(false);
      expect(service.contextCache.has('personality2:user1')).toBe(true);
    });

    it('should clear entire cache when no personality specified', () => {
      service.clearContextCache();

      expect(service.contextCache.size).toBe(0);
    });
  });

  describe('singleton pattern', () => {
    it('should return same instance', () => {
      const instance1 = getPersonalityDataService();
      const instance2 = getPersonalityDataService();

      expect(instance1).toBe(instance2);
    });
  });
});