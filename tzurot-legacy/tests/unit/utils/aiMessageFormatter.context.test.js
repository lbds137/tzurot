describe('AIMessageFormatter - Context Metadata', () => {
  let aiMessageFormatter;
  let mockLogger;
  let formatContextMetadata;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
    // Mock logger
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };
    
    jest.doMock('../../../src/logger', () => mockLogger);
    
    
    // Mock aliasResolver (PersonalityManager removed - now using DDD)
    jest.doMock('../../../src/utils/aliasResolver', () => ({
      resolvePersonality: jest.fn()
    }));
    
    // Mock contextMetadataFormatter
    formatContextMetadata = jest.fn();
    jest.doMock('../../../src/utils/contextMetadataFormatter', () => ({
      formatContextMetadata
    }));
    
    aiMessageFormatter = require('../../../src/utils/aiMessageFormatter');
  });
  
  describe('formatApiMessages with context metadata', () => {
    it('should prepend context metadata to simple text messages', async () => {
      const content = 'Hello world!';
      const personalityName = 'test-personality';
      const mockMessage = {
        guild: { name: 'Test Server' },
        channel: { type: 0, name: 'general' },
        createdTimestamp: 1720625445000
      };
      
      formatContextMetadata.mockReturnValue('[Test Server | #general | 2024-07-10T15:30:45.000Z]');
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        'a user',
        false,
        mockMessage,
        false
      );
      
      expect(formatContextMetadata).toHaveBeenCalledWith(mockMessage);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('[Test Server | #general | 2024-07-10T15:30:45.000Z] Hello world!');
    });
    
    it('should prepend context metadata to multimodal content', async () => {
      const content = [
        { type: 'text', text: 'Check this out!' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } }
      ];
      const personalityName = 'test-personality';
      const mockMessage = {
        guild: { name: 'Cool Server' },
        channel: { type: 0, name: 'images' },
        createdTimestamp: 1720625445000
      };
      
      formatContextMetadata.mockReturnValue('[Cool Server | #images | 2024-07-10T15:30:45.000Z]');
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        'a user',
        false,
        mockMessage,
        false
      );
      
      expect(formatContextMetadata).toHaveBeenCalledWith(mockMessage);
      expect(result).toHaveLength(1);
      expect(result[0].content).toHaveLength(2);
      expect(result[0].content[0].text).toBe('[Cool Server | #images | 2024-07-10T15:30:45.000Z] Check this out!');
      expect(result[0].content[1].type).toBe('image_url');
    });
    
    it('should combine context metadata with proxy message prefix', async () => {
      const content = 'Hello from both!';
      const personalityName = 'test-personality';
      const mockMessage = {
        guild: { name: 'Test Server' },
        channel: { type: 0, name: 'general' },
        createdTimestamp: 1720625445000
      };
      
      formatContextMetadata.mockReturnValue('[Test Server | #general | 2024-07-10T15:30:45.000Z]');
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        'Lila | System',
        true,
        mockMessage,
        false
      );
      
      expect(result[0].content).toBe('[Test Server | #general | 2024-07-10T15:30:45.000Z] Lila | System: Hello from both!');
    });
    
    it('should handle DM context metadata', async () => {
      const content = 'DM message';
      const personalityName = 'test-personality';
      const mockMessage = {
        guild: null,
        channel: { type: 1 },
        createdTimestamp: 1720625445000
      };
      
      formatContextMetadata.mockReturnValue('[DMs | DMs | 2024-07-10T15:30:45.000Z]');
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        'a user',
        false,
        mockMessage,
        false
      );
      
      expect(result[0].content).toBe('[DMs | DMs | 2024-07-10T15:30:45.000Z] DM message');
    });
    
    it('should skip context metadata when disableContextMetadata is true', async () => {
      const content = 'No context please';
      const personalityName = 'test-personality';
      const mockMessage = {
        guild: { name: 'Test Server' },
        channel: { type: 0, name: 'general' },
        createdTimestamp: 1720625445000
      };
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        'a user',
        false,
        mockMessage,
        true // disableContextMetadata
      );
      
      expect(formatContextMetadata).not.toHaveBeenCalled();
      expect(result[0].content).toBe('No context please');
    });
    
    it('should skip context metadata when message is null', async () => {
      const content = 'No message object';
      const personalityName = 'test-personality';
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        'a user',
        false,
        null,
        false
      );
      
      expect(formatContextMetadata).not.toHaveBeenCalled();
      expect(result[0].content).toBe('No message object');
    });
    
    it('should handle context metadata errors gracefully', async () => {
      const content = 'Error test';
      const personalityName = 'test-personality';
      const mockMessage = {
        guild: { name: 'Test Server' },
        channel: { type: 0, name: 'general' },
        createdTimestamp: 1720625445000
      };
      
      formatContextMetadata.mockImplementation(() => {
        throw new Error('Context formatting failed');
      });
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        'a user',
        false,
        mockMessage,
        false
      );
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error formatting context metadata: Context formatting failed')
      );
      expect(result[0].content).toBe('Error test'); // Should continue without context
    });
    
    it('should add context metadata to complex reference messages', async () => {
      const content = {
        messageContent: 'Replying to something',
        referencedMessage: {
          content: 'Original message',
          author: 'OriginalUser',
          isFromBot: false,
          authorId: '123',
        }
      };
      const personalityName = 'test-personality';
      const mockMessage = {
        guild: { name: 'Test Server' },
        channel: { type: 0, name: 'general' },
        createdTimestamp: 1720625445000
      };
      
      formatContextMetadata.mockReturnValue('[Test Server | #general | 2024-07-10T15:30:45.000Z]');
      
      const result = await aiMessageFormatter.formatApiMessages(
        content,
        personalityName,
        'a user',
        false,
        mockMessage,
        false
      );
      
      expect(formatContextMetadata).toHaveBeenCalledWith(mockMessage);
      expect(result).toHaveLength(1);
      // The context metadata should be prepended to the combined message
      expect(result[0].content[0].text).toContain('[Test Server | #general | 2024-07-10T15:30:45.000Z]');
      expect(result[0].content[0].text).toContain('Replying to something');
    });
  });
});